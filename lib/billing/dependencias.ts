/**
 * As DEPENDÊNCIAS REAIS da rodada de faturação: o PaySuite da organização que
 * recebe, os e-mails dos administradores e o envio. É a única parte da
 * faturação que toca a rede — `lib/billing/executar.ts` recebe tudo por
 * parâmetro e é provado sem ela.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import type { ConfigDaFaturacao } from "@/lib/billing/config";
import type { DependenciasDaRodada, Gateway } from "@/lib/billing/executar";
import { emailDeSuporte } from "@/lib/branding/saida";
import { sendEmail } from "@/lib/email/roteador";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createPayment, getPayment } from "@/lib/payments/paysuite/client";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";

/**
 * O endereço público da instalação, SEM requisição (a rodada corre num cron).
 * `null` quando ainda é o placeholder da imagem: sem webhook_url a cobrança
 * existe na mesma, e a reconciliação descobre o pagamento por consulta.
 */
function basePublica(): string | null {
  const configurada = env.NEXT_PUBLIC_APP_URL;
  if (!configurada || configurada.includes("placeholder.invalid")) return null;
  return configurada.replace(/\/+$/, "");
}

/** O PaySuite da organização que recebe. `null` = não configurado (a faturação emite, mas sem link). */
export async function gatewayDaFaturacao(db: SupabaseClient, organizationId: string): Promise<Gateway | null> {
  const { data: cred } = await db
    .from("payment_credentials")
    .select("api_token_encrypted, webhook_path_token")
    .eq("organization_id", organizationId)
    .eq("provider", "paysuite")
    .maybeSingle();
  if (!cred) return null;

  const { api_token_encrypted: cifrado, webhook_path_token: pathToken } = cred as {
    api_token_encrypted: string;
    webhook_path_token: string;
  };
  const token = await decryptWebhookSecret(db, cifrado);
  if (!token) {
    logger.error("faturação: não consegui decifrar o token do PaySuite da organização que recebe");
    return null;
  }
  const base = basePublica();

  return {
    async criar({ amountCents, reference, description }) {
      const criado = await createPayment(token, {
        amount: (amountCents / 100).toFixed(2),
        reference,
        description,
        ...(base ? { webhook_url: `${base}/api/v1/webhooks/payments/paysuite/${pathToken}` } : {}),
      });
      return { id: criado.id, checkoutUrl: criado.checkoutUrl };
    },
    async consultar(providerPaymentId) {
      return (await getPayment(token, providerPaymentId)).status;
    },
  };
}

async function emailsDosAdmins(db: SupabaseClient, organizationId: string): Promise<string[]> {
  const { data } = await db
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("role", "admin")
    .is("revoked_at", null)
    .not("accepted_at", "is", null);
  const emails = new Set<string>();
  for (const { user_id } of (data ?? []) as Array<{ user_id: string }>) {
    const { data: u } = await db.auth.admin.getUserById(user_id);
    const email = u?.user?.email?.trim().toLowerCase();
    if (email) emails.add(email);
  }
  return [...emails];
}

/**
 * Quem recebe os avisos do fornecedor: a lista que o operador escreveu em Admin ›
 * Faturação; sem ela, os administradores da plataforma (que são quem opera).
 */
async function emailsDoFornecedor(db: SupabaseClient, cfg: ConfigDaFaturacao): Promise<string[]> {
  if (cfg.emailsDoFornecedor.length > 0) return cfg.emailsDoFornecedor;
  const { data } = await db.from("platform_admins").select("user_id").is("revoked_at", null);
  const emails = new Set<string>();
  for (const { user_id } of (data ?? []) as Array<{ user_id: string }>) {
    const { data: u } = await db.auth.admin.getUserById(user_id);
    const email = u?.user?.email?.trim().toLowerCase();
    if (email) emails.add(email);
  }
  return [...emails];
}

export async function dependenciasReais(db: SupabaseClient, cfg: ConfigDaFaturacao): Promise<DependenciasDaRodada> {
  const suporte = (await emailDeSuporte().catch(() => "")) || null;
  return {
    db,
    cfg,
    agora: new Date(),
    gateway: await gatewayDaFaturacao(db, cfg.organizationId),
    emailsDosAdmins: (org) => emailsDosAdmins(db, org),
    emailsDoFornecedor: () => emailsDoFornecedor(db, cfg),
    enviarEmail: async (para, m) => {
      const r = await sendEmail({ to: para, subject: m.assunto, html: m.html, text: m.texto });
      if (!r.ok) logger.warn("faturação: e-mail recusado", { erro: r.error, detalhe: r.details });
      return r.ok;
    },
    suporte,
    auditar: (e) =>
      void audit({
        action: e.action,
        organizationId: e.organizationId,
        resourceType: e.resourceType,
        resourceId: e.resourceId,
        metadata: e.metadata,
        bypassedRls: true,
      }),
  };
}
