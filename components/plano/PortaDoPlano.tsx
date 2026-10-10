/**
 * A porta de uma secção do produto que depende do PACOTE da organização
 * (`lib/plans/funcionalidades.ts`). Vai num `layout.tsx` da secção — nunca no
 * layout raiz de `/app`, que o Next não volta a executar numa navegação entre
 * páginas.
 *
 * Fora do pacote, a pessoa lê o que falta e o que fazer, em vez de uma tela
 * vazia ou de um 404: o dado dela continua guardado e a secção volta inteira
 * quando o plano sobe. A recusa que PROTEGE é a da API (`requireRole`); isto é
 * só o que se vê.
 */
import type { ReactNode } from "react";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import {
  funcionalidadesDaOrganizacao,
  mensagemDeFuncionalidadeForaDoPlano,
  ROTULO_DA_FUNCIONALIDADE,
  type FuncionalidadeDoPlano,
} from "@/lib/plans/funcionalidades";
import { createAdminClient } from "@/lib/supabase/admin";

export async function PortaDoPlano({
  funcionalidade,
  children,
}: {
  funcionalidade: FuncionalidadeDoPlano;
  children: ReactNode;
}) {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  // Sem organização ativa a casca já decide o destino; esta porta não inventa um.
  if (!activeOrg) return <>{children}</>;

  const incluidas = await funcionalidadesDaOrganizacao(createAdminClient(), activeOrg.orgId);
  if (incluidas.includes(funcionalidade)) return <>{children}</>;

  const t = (texto: string) => traduzir(texto, user.idioma);
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-3 px-4 py-24 text-center" data-testid="fora-do-plano">
      <h1 className="text-xl font-semibold">{t(ROTULO_DA_FUNCIONALIDADE[funcionalidade])}</h1>
      <p className="text-muted-foreground text-sm">{t(mensagemDeFuncionalidadeForaDoPlano(funcionalidade))}</p>
      <p className="text-muted-foreground text-sm">
        {t("Os seus dados continuam guardados. Fale com o seu gestor de conta para mudar de pacote.")}
      </p>
    </div>
  );
}
