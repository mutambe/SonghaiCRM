/**
 * POST /api/v1/webhooks/subscricoes — subscrição dos tenants por webhook
 * (SonghaiCRM).
 *
 * O site (songhai.cc) ou o processador de pagamento chama aqui quando alguém
 * contrata (`subscription.created`), muda de pacote (`subscription.plan_changed`)
 * ou cancela (`subscription.cancelled`). A organização é criada, o pacote vira a
 * assinatura vigente e o dono recebe o convite — pelas MESMAS funções do admin da
 * plataforma (`lib/subscricoes/servico.ts`).
 *
 * Autenticação: `X-Signature` = HMAC-SHA256 hex do corpo CRU com
 * `SUBSCRICOES_WEBHOOK_SECRET` (o mesmo algoritmo dos outros webhooks de entrada).
 * Sem o segredo configurado a rota responde 404: DESLIGADA por omissão, como
 * módulo que ninguém ligou. Corpo fora de `occurred_at ± 10 min` é recusado, e
 * `event_id` torna o reenvio idempotente (o mesmo evento nunca cria duas
 * organizações).
 *
 * "Público" para o `proxy.ts` quer dizer só "o proxy não decide": quem autentica
 * é a assinatura, aqui.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { eventoDeSubscricaoSchema, eventoForaDaJanela } from "@/lib/subscricoes/evento";
import { aplicarEvento, resolverAtor } from "@/lib/subscricoes/servico";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyInboundSignature } from "@/lib/webhooks/inbound";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Corpo máximo aceito: um evento tem poucas centenas de bytes. */
const TETO_DO_CORPO = 16 * 1024;

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const segredo = env.SUBSCRICOES_WEBHOOK_SECRET;
  if (!segredo) return fail("not_found", "Not found", 404, { requestId });

  const bruto = await req.text();
  if (bruto.length > TETO_DO_CORPO) {
    return fail("validation_error", "Corpo grande demais", 413, { requestId });
  }
  if (!verifyInboundSignature(bruto, req.headers.get("x-signature"), segredo)) {
    logger.warn("[webhooks.subscricoes] assinatura inválida", { requestId });
    return fail("unauthorized", "assinatura inválida", 401, { requestId });
  }

  let json: unknown;
  try {
    json = JSON.parse(bruto);
  } catch {
    return fail("validation_error", "corpo não é JSON válido", 400, { requestId });
  }
  const parsed = eventoDeSubscricaoSchema.safeParse(json);
  if (!parsed.success) {
    return fail("validation_error", "Evento inválido", 400, { requestId, details: parsed.error.flatten() });
  }
  const evento = parsed.data;
  if (eventoForaDaJanela(evento.occurred_at, new Date())) {
    return fail("validation_error", "occurred_at fora da janela de 10 minutos", 400, { requestId });
  }

  const admin = createAdminClient();
  const ator = await resolverAtor(admin, env.SUBSCRICOES_WEBHOOK_ATOR_EMAIL);
  if (!ator) {
    logger.error("[webhooks.subscricoes] nenhum administrador da plataforma para agir", { requestId });
    return fail("internal_error", "Instalação sem administrador da plataforma configurado", 500, { requestId });
  }

  const desfecho = await aplicarEvento(admin, evento, ator, requestId);
  if (!desfecho.ok) {
    return fail(desfecho.codigo, desfecho.mensagem, desfecho.status, { requestId });
  }
  return ok(desfecho.corpo, { status: desfecho.status, requestId });
}
