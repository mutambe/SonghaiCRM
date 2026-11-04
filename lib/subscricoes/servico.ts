/**
 * Executa um evento de subscrição (SonghaiCRM). Reusa as MESMAS funções do admin
 * da plataforma — `fn_create_tenant_with_owner`, `fn_trocar_plano_da_organizacao`,
 * `fn_suspender_organizacao` — para o webhook nunca ter uma regra própria de
 * criar, trocar ou suspender.
 *
 * Quem chama já verificou a assinatura. A organização vem do PATH do evento
 * (slug), nunca de um id do corpo; todas as escritas usam o service role e
 * filtram pela organização resolvida aqui.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

import { audit } from "@/lib/audit";
import { issueInvite } from "@/lib/auth/issue-invite";
import { alterarTermosDoCliente } from "@/lib/billing/admin";
import { invalidarOrg } from "@/lib/auth/cache-curto";
import { ehAnonimizada } from "@/lib/organizacao/operante";
import { logger } from "@/lib/logger";

import { chaveDoEvento, slugDoNome, type EventoDeSubscricao } from "./evento";

export type Desfecho =
  | { ok: true; status: 200 | 201; corpo: Record<string, unknown> }
  | { ok: false; status: 404 | 409 | 422 | 500; codigo: string; mensagem: string };

export interface AtorDoWebhook {
  id: string;
  email: string | null;
  nome: string;
}

/**
 * O administrador da plataforma em nome de quem o webhook age (fica no vínculo
 * provisório do criador e na auditoria). Com `emailConfigurado`, só esse; sem,
 * o mais antigo com escopo total.
 */
export async function resolverAtor(db: SupabaseClient, emailConfigurado: string): Promise<AtorDoWebhook | null> {
  const { data: admins } = await db
    .from("platform_admins")
    .select("user_id, granted_at")
    .eq("scope", "full")
    .is("revoked_at", null)
    .order("granted_at", { ascending: true })
    .limit(20);
  for (const a of admins ?? []) {
    const { data } = await db.auth.admin.getUserById(a.user_id as string);
    const user = data?.user;
    if (!user) continue;
    const email = user.email?.trim().toLowerCase() ?? null;
    if (emailConfigurado && email !== emailConfigurado.trim().toLowerCase()) continue;
    return {
      id: a.user_id as string,
      email,
      nome: (user.user_metadata?.full_name as string | undefined) ?? email ?? "Administrador",
    };
  }
  return null;
}

async function trocarPlano(
  db: SupabaseClient,
  organizationId: string,
  plan: string,
  ator: string,
  notas: string | null,
): Promise<string | null> {
  const { data: plano } = await db.from("plans").select("id, is_active").eq("slug", plan).maybeSingle();
  if (!plano) return `plano ${plan} não está no catálogo`;
  if (plano.is_active === false) return `plano ${plan} está fora de venda`;
  const { error } = await db.rpc("fn_trocar_plano_da_organizacao", {
    p_org: organizationId,
    p_plan: plano.id,
    p_actor: ator,
    p_notes: notas,
  });
  return error ? error.message : null;
}

export async function aplicarEvento(
  db: SupabaseClient,
  evento: EventoDeSubscricao,
  ator: AtorDoWebhook,
  requestId: string,
): Promise<Desfecho> {
  if (evento.event === "subscription.created") {
    const d = evento.data;
    const owner = d.owner.email.trim().toLowerCase();
    const slugPedido = d.organization.slug ?? slugDoNome(d.organization.display_name);
    const chamar = (slug: string) => {
      const request = {
        display_name: d.organization.display_name,
        slug,
        ...(d.organization.legal_name ? { legal_name: d.organization.legal_name } : {}),
        ...(d.organization.nuit ? { cnpj: d.organization.nuit } : {}),
        plan: d.plan,
        owner_email: owner,
      };
      return db.rpc("fn_create_tenant_with_owner", {
        p_actor: ator.id,
        p_key: chaveDoEvento(evento.event_id),
        p_request: request,
        p_hash: createHash("sha256").update(JSON.stringify(request)).digest("hex"),
      });
    };
    let { data: org, error } = await chamar(slugPedido);
    // Slug DERIVADO do nome e já tomado: tenta UMA vez com sufixo do evento.
    // Slug pedido pelo remetente que colide é conflito real e não se adivinha.
    if (error && error.code === "23505" && !d.organization.slug) {
      ({ data: org, error } = await chamar(`${slugPedido.slice(0, 33)}-${chaveDoEvento(evento.event_id).slice(0, 6)}`));
    }
    if (error || !org) {
      if (error && (error.code === "23505" || error.code === "22023")) {
        return { ok: false, status: 409, codigo: "conflict", mensagem: "Slug já existe ou o evento foi usado com outros dados" };
      }
      logger.error("[webhooks.subscricoes] organização não criada", { requestId, erro: error?.message });
      return { ok: false, status: 500, codigo: "internal_error", mensagem: "Não foi possível criar a organização" };
    }

    if (org.created) {
      const falha = await trocarPlano(db, org.id, d.plan, ator.id, `subscription.created ${evento.event_id}`);
      if (falha) {
        // Sem assinatura a organização só fica sem teto; o admin atribui depois.
        logger.error("[webhooks.subscricoes] organização criada sem assinatura", { requestId, organizationId: org.id, falha });
      } else if (d.is_pilot || d.agreed_price_cents !== undefined || d.agreed_setup_cents !== undefined) {
        const termos = await alterarTermosDoCliente(db, org.id, {
          ...(d.is_pilot ? { is_pilot: true } : {}),
          ...(d.agreed_price_cents !== undefined ? { agreed_price_cents: d.agreed_price_cents } : {}),
          ...(d.agreed_setup_cents !== undefined ? { agreed_setup_cents: d.agreed_setup_cents } : {}),
        });
        if (!termos.ok) {
          logger.error("[webhooks.subscricoes] sem os termos comerciais", { requestId, organizationId: org.id, erro: termos.erro });
        }
      }
      await audit({
        action: "tenant.created_by_subscription_webhook",
        actorUserId: ator.id,
        actingAsPlatformAdmin: true,
        bypassedRls: true,
        organizationId: org.id,
        resourceType: "organization",
        resourceId: org.id,
        requestId,
        metadata: { slug: org.slug, plan: d.plan, event_id: evento.event_id },
      });
    }

    // O dono recebe o convite (o mesmo do admin). Replay: o convite não é reenviado.
    let convite: { email_dispatched: boolean } | null = null;
    if (owner !== ator.email) {
      try {
        const emitido = await issueInvite({
          email: owner,
          role: "admin",
          organizationId: org.id,
          orgName: org.display_name,
          inviterId: ator.id,
          inviterName: ator.nome,
          requestId,
          inviteId: org.invite_id,
          issuedAt: org.issued_at,
          dispatch: org.created,
        });
        convite = { email_dispatched: emitido.email_dispatched };
        if (org.created) {
          await db.from("team_invites").upsert(
            {
              id: emitido.invite_id,
              organization_id: org.id,
              email: emitido.email,
              role: "admin",
              invited_by: ator.id,
              inviter_name: ator.nome,
              email_dispatched: emitido.email_dispatched,
              last_sent_at: new Date().toISOString(),
              expires_at: emitido.expires_at,
            },
            { onConflict: "id", ignoreDuplicates: true },
          );
        }
      } catch (erro) {
        logger.error("[webhooks.subscricoes] convite do dono falhou", { requestId, organizationId: org.id, erro: String(erro) });
      }
    }
    return {
      ok: true,
      status: org.created ? 201 : 200,
      corpo: { organization_id: org.id, slug: org.slug, created: Boolean(org.created), owner_invitation: convite },
    };
  }

  // Os dois outros eventos nomeiam uma organização EXISTENTE, pelo slug.
  const { data: org } = await db
    .from("organizations")
    .select("id, slug, status")
    .eq("slug", evento.data.organization_slug)
    .maybeSingle();
  if (!org) return { ok: false, status: 404, codigo: "not_found", mensagem: "Organização não encontrada" };
  if (ehAnonimizada(org.status)) {
    return { ok: false, status: 409, codigo: "state_conflict", mensagem: "Organização anonimizada" };
  }

  if (evento.event === "subscription.plan_changed") {
    const falha = await trocarPlano(
      db,
      org.id,
      evento.data.plan,
      ator.id,
      evento.data.notes ?? `subscription.plan_changed ${evento.event_id}`,
    );
    if (falha) {
      const semPlano = /catálogo|fora de venda/.test(falha);
      return {
        ok: false,
        status: semPlano ? 422 : 500,
        codigo: semPlano ? "plano_invalido" : "internal_error",
        mensagem: falha,
      };
    }
    await audit({
      action: "tenant.subscription_changed",
      actorUserId: ator.id,
      actingAsPlatformAdmin: true,
      bypassedRls: true,
      organizationId: org.id,
      resourceType: "organization",
      resourceId: org.id,
      requestId,
      metadata: { plan: evento.data.plan, via: "webhook", event_id: evento.event_id },
    });
    return { ok: true, status: 200, corpo: { organization_id: org.id, plan: evento.data.plan } };
  }

  // subscription.cancelled → suspensão administrativa (reversível; nada é apagado).
  const { data, error } = await db.rpc("fn_suspender_organizacao", {
    p_org: org.id,
    p_kind: "administrativa",
    p_motivo: evento.data.reason,
    p_ator: ator.id,
  });
  if (error) {
    logger.error("[webhooks.subscricoes] suspensão falhou", { requestId, organizationId: org.id, erro: error.message });
    return { ok: false, status: 500, codigo: "internal_error", mensagem: "Não foi possível suspender a organização" };
  }
  invalidarOrg(org.id);
  await audit({
    action: "tenant.suspended_by_subscription_webhook",
    actorUserId: ator.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: org.id,
    resourceType: "organization",
    resourceId: org.id,
    requestId,
    metadata: { event_id: evento.event_id },
  });
  return {
    ok: true,
    status: 200,
    corpo: { organization_id: org.id, ...(typeof data === "object" && data ? (data as Record<string, unknown>) : {}) },
  };
}
