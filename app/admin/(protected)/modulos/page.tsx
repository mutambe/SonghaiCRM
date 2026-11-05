import { notFound } from "next/navigation";

import { ModulosManager } from "@/components/modulos/ModulosManager";
import { loadAuthUser } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { MODULOS_DO_BRASIL } from "@/lib/instalacao/modulos";
import { listarModulos } from "@/lib/modulos/service";

export const metadata = { title: "Módulos da instalação" };
export const dynamic = "force-dynamic";

/**
 * MÓDULOS OPCIONAIS COM TABELA PRÓPRIA (ADR-0002).
 *
 * Diferente de uma extensão (catálogo remoto, pacote baixado, ativação por organização), um
 * módulo é instalado uma vez NA INSTÂNCIA pelo administrador da instalação — sem organização
 * para escolher, porque D3 é claro: "o corte é por instalação". Por isso esta tela tem
 * escrita (o botão Instalar), ao contrário da vizinha `extensoes/`, que é só leitura porque
 * instalar extensão já tem lar em `/app/extensions`.
 */
export default async function Page() {
  const usuario = await loadAuthUser();
  if (!usuario?.is_platform_admin) notFound();
  const idioma = normalizarIdioma(usuario.locale);
  const t = (s: string) => traduzir(s, idioma);

  // SonghaiCRM: Honorários é módulo do Brasil e não se oferece para instalar; onde já está
  // instalado continua listado (para o dono o poder suspender ou reaplicar).
  const todos = await listarModulos();
  const jaInstalado = new Set(todos.instalados.map((m) => m.modulo));
  const modulos = {
    ...todos,
    disponiveis: todos.disponiveis.filter(
      (m) => !(MODULOS_DO_BRASIL as readonly string[]).includes(m.slug) || jaInstalado.has(m.slug),
    ),
  };

  return (
    <div className="space-y-6" data-testid="tela-modulos-da-instalacao">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Módulos da instalação")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-muted">
          {t(
            "Módulos opcionais com tabela própria, criados quando você instala — quem não instala não carrega as tabelas dele. Instalar aqui vale para todas as organizações desta instalação.",
          )}
        </p>
      </div>
      <ModulosManager inicial={modulos} />
    </div>
  );
}
