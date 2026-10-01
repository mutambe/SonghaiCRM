import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

import { PaySuiteForm } from "./_components/PaySuiteForm";

export const dynamic = "force-dynamic";

/**
 * PAGAMENTOS (PaySuite) — SonghaiCRM.
 *
 * O admin cola o token de API e o segredo de webhook do painel do PaySuite
 * (Settings › API Access) e recebe a URL de webhook para colar de volta lá.
 * Sem OAuth: o PaySuite não tem. A cobrança em si sai do negócio, pelo botão
 * "Cobrar" (`POST /api/v1/leads/[id]/charge`).
 *
 * Só admin: a tela recebe o segredo da conta de pagamento da empresa.
 */
export default async function PaySuitePage() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");
  if (ROLE_RANK[org.role] < ROLE_RANK.admin) redirect("/403");
  const t = (texto: string) => traduzir(texto, user.idioma);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-xl font-semibold">{t("Pagamentos (PaySuite)")}</h1>
        <p className="mt-1 text-sm text-text-muted">
          {t("Cobre por M-Pesa, e-Mola ou cartão com um link gerado a partir do negócio. O dinheiro cai na conta PaySuite da sua empresa.")}
        </p>
      </header>
      <PaySuiteForm />
    </div>
  );
}
