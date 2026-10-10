/**
 * Adapter fino que pluga `aplicaAvisoPorEmail` (`./aviso-por-email.ts`) no
 * dispatcher do `event_log` — mesmo desenho de `./aviso-ao-suporte.handler.ts`:
 * a regra fica pura e testável, aqui só há a ligação com os clients de produção.
 *
 * ⚠️ O `status` NUNCA é `error`, exceto no `catch`, que existe para defeito de
 * PROGRAMA (uma coluna errada, um client que não subiu) e não para estado do
 * mundo: "esta organização não ligou o aviso por e-mail" é o caso de quase toda
 * instalação, e tratá-lo como falha mataria o evento de todo caso.
 *
 * O envio usa o roteador de e-mail por import TARDIO: `lib/event-log/drain-loop.ts`
 * carrega este módulo sob `tsx`, onde um import de topo pesado já parou o dreno
 * por dez dias (#648).
 */
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { createSupabaseAvisoDb, EVENTO_CASO_ABERTO } from "@/lib/escalacao/aviso-ao-suporte";
import { origemDoDreno } from "@/lib/event-log/origem-do-dreno";
import type { EventHandler, HandlerResult } from "@/lib/event-log/dispatcher";
import { createAdminClient } from "@/lib/supabase/admin";

import { AVISO_POR_EMAIL_HANDLER_KEY, aplicaAvisoPorEmail, type ConfigDoAvisoPorEmail } from "./aviso-por-email";

export const avisoDeCasoPorEmailHandler: EventHandler = {
  key: AVISO_POR_EMAIL_HANDLER_KEY,
  // Sai por rede de terceiro (e-mail): numa organização parada não gasta nem fala.
  naOrgParada: "pula",
  events: [EVENTO_CASO_ABERTO],
  async handle(row): Promise<HandlerResult> {
    try {
      const admin = createAdminClient();
      const avisoDb = createSupabaseAvisoDb(admin);
      const desfecho = await aplicaAvisoPorEmail(
        {
          db: {
            async carregaConfigEmail(orgId): Promise<ConfigDoAvisoPorEmail | null> {
              // `organization_id` filtrado À MÃO: o client é o de service role, que bypassa a RLS.
              const { data } = await admin
                .from("config_aviso_de_caso_email")
                .select("organization_id, emails, ligado")
                .eq("organization_id", orgId)
                .maybeSingle();
              return (data as ConfigDoAvisoPorEmail | null) ?? null;
            },
            carregaCaso: (orgId, caseId) => avisoDb.carregaCaso(orgId, caseId),
            contatoAnonimizado: (orgId, contactId) => avisoDb.contatoAnonimizado(orgId, contactId),
            nomeDoContato: (orgId, contactId) => avisoDb.nomeDoContato(orgId, contactId),
            marcaDaOrganizacao: (orgId) => avisoDb.marcaDaOrganizacao(orgId),
          },
          async enviarEmail(para, m) {
            const { sendEmail } = await import("@/lib/email/roteador");
            const r = await sendEmail({ to: para, subject: m.assunto, html: m.html, text: m.texto });
            return r.ok;
          },
          clock: () => new Date(),
          urlPublica: env.NEXT_PUBLIC_APP_URL,
          origemDoDreno,
          audita: (entrada) => {
            void audit({
              action: "ai.case_email_alert_sent",
              organizationId: entrada.organizationId,
              resourceType: "agent_case",
              resourceId: entrada.caseId,
              bypassedRls: true,
              metadata: entrada.metadata,
            });
          },
        },
        row,
      );
      return {
        consumer_key: AVISO_POR_EMAIL_HANDLER_KEY,
        status: desfecho.status,
        ...(desfecho.retry_at ? { retry_at: desfecho.retry_at } : {}),
        detail: desfecho.detail,
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return { consumer_key: AVISO_POR_EMAIL_HANDLER_KEY, status: "error", detail };
    }
  },
};
