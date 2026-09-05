import { notFound } from "next/navigation";

import { loadAuthUser } from "@/lib/auth/server";

import { PaySuiteCredencialForm } from "./_paysuite-form";
import { LicencasCentral } from "./_licencas";

export const metadata = { title: "Licenciamento" };
export const dynamic = "force-dynamic";

/**
 * Tela da instância CENTRAL (Songhai): credencial do PaySuite + emissão de
 * licenças. Só existe sentido nesta VPS (a que opera a venda) — uma
 * instalação de CLIENTE nunca chega aqui porque não tem `is_platform_admin`
 * apontando pra este papel (ver docs/superpowers/plans/
 * 2026-09-04-licenciamento-paysuite.md).
 *
 * `notFound()` e não `redirect('/403')`: mesma escolha de `/admin/marca` —
 * pra quem não administra, esta tela não faz parte do produto.
 */
export default async function Page() {
  const usuario = await loadAuthUser();
  if (!usuario?.is_platform_admin) notFound();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Licenciamento</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Credencial do PaySuite desta Central e as licenças emitidas para clientes self-host.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Credencial PaySuite</h2>
        <PaySuiteCredencialForm />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Licenças</h2>
        <LicencasCentral />
      </section>
    </div>
  );
}
