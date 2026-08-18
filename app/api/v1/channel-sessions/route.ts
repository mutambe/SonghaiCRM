/**
 * GET  /api/v1/channel-sessions — lista os canais WhatsApp da org (do DB).
 *   Acessível a qualquer membro (usado pelo seletor do inbox e pela sidebar).
 * POST /api/v1/channel-sessions — conecta um NOVO número (cria a sessão com
 *   nome único e inicia no WAHA). Admin only.
 *
 * organization_id resolvido da sessão (cookie) — nunca do body.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { ok, fail } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { requireRole } from "@/lib/auth/require-role";
import { ARCHIVED_AT, queryTolerantToMissingArchived } from "@/lib/channels/archived";
import { getEvolutionClient } from "@/lib/evolution/client";
import { env } from "@/lib/env";
import { createChannelSchema } from "@/lib/schemas/channels";
import { createClient } from "@/lib/supabase/server";
import { getWahaClient, wahaFriendlyError } from "@/lib/waha/client";

export const dynamic = "force-dynamic";

export const CHANNEL_COLUMNS =
  "id, provider, waha_session_name, evolution_instance_name, display_name, phone_number, status, status_reason, last_health_check_at, last_status_change_at, daily_message_limit, is_warmup_complete, created_at";

/**
 * Base pública desta instalação, para montar a URL do webhook que a Evolution
 * API chama de volta. Mesma guarda de `app/api/v1/channels/official/route.ts`:
 * `env.*` e NÃO `process.env.NEXT_PUBLIC_APP_URL` direto — variáveis
 * `NEXT_PUBLIC_` são substituídas no BUILD, e a imagem genérica do self-host é
 * construída com `https://placeholder.invalid` (Dockerfile). Configurar o
 * webhook com esse valor apontaria a Evolution API para o nada, sem erro em
 * lugar nenhum.
 */
function publicBase(req: NextRequest): string {
  const configurada = env.NEXT_PUBLIC_APP_URL;
  const usavel = configurada && !configurada.includes("placeholder.invalid") ? configurada : null;
  return usavel ?? req.headers.get("origin") ?? `${req.nextUrl.protocol}//${req.nextUrl.host}`;
}

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const user = await loadAuthUser();
  if (!user) return fail("unauthenticated", "Auth required.", 401, { requestId });
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) return fail("forbidden_tenant", "Nenhuma organização ativa.", 403, { requestId });

  const supabase = await createClient();
  const base = () =>
    supabase
      .from("channel_sessions")
      .select(CHANNEL_COLUMNS)
      .eq("organization_id", activeOrg.orgId);
  // Canais arquivados sobrevivem só como âncora das FKs RESTRICT
  // (conversations/messages). Para o usuário eles foram excluídos.
  //
  // Tolerante à coluna ausente porque esta é a PRIMEIRA tela de quem já tem
  // número ligado: num clone que subiu o código sem a migration 0106, o filtro
  // devolveria 42703 → 500 → "Nenhum número conectado ainda", convidando o
  // operador a parear de novo um número que já está no ar. Sem a coluna, nada
  // está arquivado, e a lista sem o filtro é a lista certa (ver lib/channels/archived).
  const { data, error, schemaOutdated } = await queryTolerantToMissingArchived(
    () => base().is(ARCHIVED_AT, null).order("created_at", { ascending: true }),
    () => base().order("created_at", { ascending: true }),
  );
  if (error) return fail("internal_error", error.message, 500, { requestId });

  return ok(data ?? [], {
    requestId,
    ...(schemaOutdated ? { meta: { schema_outdated: true } } : {}),
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", {
    requestId,
    resource: "channel_sessions",
    allowPlatformAdmin: true,
  });
  if (!authz.ok) return authz.response;
  const { user, org: activeOrg } = authz;

  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  const parsed = createChannelSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }
  const provider = parsed.data.provider;

  const waha = provider === "waha" ? getWahaClient() : null;
  const evolution = provider === "evolution" ? getEvolutionClient() : null;
  if (provider === "waha" && !waha) {
    return fail(
      "waha_not_configured",
      "O WhatsApp (WAHA) não está configurado neste ambiente: faltam WAHA_API_BASE_URL e/ou WAHA_API_KEY. Configure-as e tente de novo.",
      503,
      { requestId },
    );
  }
  if (provider === "evolution" && !evolution) {
    return fail(
      "evolution_not_configured",
      "O Evolution API não está configurado neste ambiente: faltam EVOLUTION_API_BASE_URL e/ou EVOLUTION_API_KEY.",
      503,
      { requestId },
    );
  }

  const supabase = await createClient();
  // Nome de sessão único por canal — o hardcode `org_<8>` era 1 número por org.
  const sessionName = `org_${activeOrg.orgId.slice(0, 8)}_${randomUUID().replace(/-/g, "").slice(0, 6)}`;
  // Gerado antes do insert (e não lido de volta de `created`) porque
  // `CHANNEL_COLUMNS` não traz `webhook_path_token` — é o mesmo token que vamos
  // gravar, então guardar a variável evita um segundo select só para isto.
  const webhookPathToken = randomUUID().replace(/-/g, "");

  const { data: created, error: insErr } = await supabase
    .from("channel_sessions")
    .insert({
      organization_id: activeOrg.orgId,
      provider,
      ...(provider === "waha" ? { waha_session_name: sessionName, engine: "NOWEB" } : {}),
      ...(provider === "evolution" ? { evolution_instance_name: sessionName } : {}),
      display_name: parsed.data.display_name ?? null,
      webhook_path_token: webhookPathToken,
      webhook_secret_encrypted: Buffer.from([0]),
      status: "STARTING",
      last_status_change_at: new Date().toISOString(),
      consecutive_health_fails: 0,
      daily_message_limit: 250,
      metadata: {},
    })
    .select(CHANNEL_COLUMNS)
    .single();
  if (insErr || !created) {
    return fail("internal_error", insErr?.message ?? "channel_session_insert_failed", 500, { requestId });
  }

  try {
    if (provider === "waha" && waha) await waha.startSession(sessionName);
    if (provider === "evolution" && evolution) {
      await evolution.createInstance(sessionName);
      const base = publicBase(req);
      await evolution.configureWebhook(sessionName, `${base}/api/v1/webhooks/channel/${webhookPathToken}`);
    }
  } catch (err) {
    // Rollback: sem o transporte escolhido no ar, não deixamos um canal fantasma
    // preso em STARTING.
    await supabase
      .from("channel_sessions")
      .delete()
      .eq("organization_id", activeOrg.orgId)
      .eq("id", created.id);
    const msg = provider === "waha" ? wahaFriendlyError(err) : err instanceof Error ? err.message : "erro_desconhecido";
    return fail(provider === "waha" ? "waha_error" : "evolution_error", msg, 502, { requestId });
  }

  void audit({
    action: "channel.connected",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "channel_session",
    resourceId: created.id,
    requestId,
    metadata: { provider, session_name: sessionName },
  });

  return ok(created, { requestId, status: 201 });
}
