/**
 * O contrato do webhook de SUBSCRIÇÃO dos tenants (SonghaiCRM).
 *
 * Quem chama é o site (songhai.cc) ou o processador de pagamento dele, quando
 * alguém contrata, muda ou cancela um pacote. Puro e sem I/O: a rota assina, o
 * serviço (`./servico.ts`) executa.
 *
 * `event_id` é a chave de idempotência — o remetente reenvia o que não recebe
 * 2xx, e o mesmo evento nunca cria duas organizações.
 */
import { createHash } from "node:crypto";
import { z } from "zod";

import { SLUGS_DE_PLANO } from "@/lib/plans/catalogo";

const centimos = z.number().int().min(0).max(1_000_000_000);
const slug = z
  .string()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9-]+$/, "Apenas letras minúsculas, números e hífens");

const base = {
  /** Identifica o evento no remetente; o mesmo valor = a mesma operação. */
  event_id: z.string().trim().min(8).max(120),
  /** Quando o remetente gerou o evento. Fora de ±10 min é recusado (reenvio antigo). */
  occurred_at: z.string().datetime({ offset: true }).optional(),
};

export const eventoDeSubscricaoSchema = z.discriminatedUnion("event", [
  z.object({
    ...base,
    event: z.literal("subscription.created"),
    data: z.object({
      plan: z.enum(SLUGS_DE_PLANO),
      organization: z.object({
        display_name: z.string().trim().min(2).max(120),
        /** Ausente = derivado do nome. */
        slug: slug.optional(),
        legal_name: z.string().trim().max(255).optional(),
        /** NUIT da empresa (guardado na coluna `cnpj`, 9 dígitos). */
        nuit: z.string().trim().max(18).optional(),
      }),
      owner: z.object({ email: z.string().trim().email() }),
      /** Preço acordado só com este cliente; ausente = vale o do pacote. */
      agreed_price_cents: centimos.optional(),
      agreed_setup_cents: centimos.optional(),
      is_pilot: z.boolean().optional(),
    }),
  }),
  z.object({
    ...base,
    event: z.literal("subscription.plan_changed"),
    data: z.object({
      organization_slug: slug,
      plan: z.enum(SLUGS_DE_PLANO),
      notes: z.string().trim().max(500).optional(),
    }),
  }),
  z.object({
    ...base,
    event: z.literal("subscription.cancelled"),
    data: z.object({
      organization_slug: slug,
      reason: z.string().trim().min(10).max(500),
    }),
  }),
]);

export type EventoDeSubscricao = z.infer<typeof eventoDeSubscricaoSchema>;

/** Janela de aceitação de `occurred_at`: um reenvio de ontem não vale. */
export const JANELA_DO_EVENTO_MS = 10 * 60 * 1000;

export function eventoForaDaJanela(occurredAt: string | undefined, agora: Date): boolean {
  if (!occurredAt) return false;
  const t = Date.parse(occurredAt);
  if (!Number.isFinite(t)) return true;
  return Math.abs(agora.getTime() - t) > JANELA_DO_EVENTO_MS;
}

/**
 * `event_id` → UUID estável, para a chave de idempotência de
 * `fn_create_tenant_with_owner` (que exige uuid). Mesmo evento, mesma chave.
 */
export function chaveDoEvento(eventId: string): string {
  const h = createHash("sha256").update(`subscricao:${eventId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Slug derivado do nome: minúsculas, sem acento, hífens. */
export function slugDoNome(nome: string): string {
  const s = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return s.length >= 2 ? s : `cliente-${createHash("sha256").update(nome).digest("hex").slice(0, 6)}`;
}
