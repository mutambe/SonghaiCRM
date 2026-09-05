import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { emailDeSuporte } from "@/lib/branding/saida";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { avaliarAcesso } from "@/lib/licensing/gate";
import { verifyLicenseToken } from "@/lib/licensing/token";
import { resolvePublicKeyPem } from "@/lib/licensing/chave-publica";
import { Card } from "@/components/ui/card";
import { RenovarLicencaButton } from "./_components/RenovarLicencaButton";

export const dynamic = "force-dynamic";

/**
 * A tela de dinheiro entregava o nosso contato ao cliente do revendedor, e ela
 * tem porta de 1ª classe no menu. Mesmo tratamento da tela de conta suspensa:
 * o endereço é o de quem opera a instalação (`SUPPORT_EMAIL`) e, sem ele
 * configurado, nenhum endereço aparece.
 */
export default async function BillingPage() {
  // spec 13 §4: billing é admin-only (viewer/agent/manager = none).
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg || ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    redirect("/403");
  }
  const suporte = emailDeSuporte();

  if (!env.LICENSE_KEY || !env.LICENSING_CENTRAL_URL) {
    return (
      <div className="flex h-full flex-col gap-6 p-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
          <p className="text-sm text-muted-foreground">Planos, faturas e cobrança.</p>
        </header>
        <Card className="max-w-xl p-6">
          <h2 className="text-sm font-semibold">Licenciamento não configurado</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Esta instalação não tem `LICENSE_KEY`/`LICENSING_CENTRAL_URL` no `.env`.{" "}
            {suporte ? (
              <>
                Contate{" "}
                <a className="underline" href={`mailto:${suporte}`}>
                  {suporte}
                </a>
                .
              </>
            ) : (
              <>Fale com quem administra este sistema.</>
            )}
          </p>
        </Card>
      </div>
    );
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("licensing_client_state")
    .select("token, fetched_at")
    .eq("id", "singleton")
    .maybeSingle();
  const row = data as { token: string | null; fetched_at: string | null } | null;

  const publicKeyPem = resolvePublicKeyPem();
  const decisao = avaliarAcesso(
    { token: row?.token ?? null, fetchedAt: row?.fetched_at ? new Date(row.fetched_at) : null },
    new Date(),
    publicKeyPem,
  );
  const payload = row?.token ? verifyLicenseToken(row.token, publicKeyPem) : null;

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="text-sm text-muted-foreground">Assinatura desta instalação.</p>
      </header>
      {decisao.bloqueado ? (
        <Card className="max-w-xl border-destructive/50 p-6">
          <h2 className="text-sm font-semibold text-destructive">Assinatura pendente</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Criar ou editar dados está bloqueado até regularizar. Leitura continua disponível
            normalmente.
          </p>
          <div className="mt-4">
            <RenovarLicencaButton />
          </div>
        </Card>
      ) : (
        <Card className="max-w-xl p-6">
          <h2 className="text-sm font-semibold">Assinatura em dia</h2>
          {payload ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Renova até {new Date(payload.current_period_end).toLocaleDateString("pt-MZ")}.
            </p>
          ) : null}
          <div className="mt-4">
            <RenovarLicencaButton />
          </div>
        </Card>
      )}
    </div>
  );
}
