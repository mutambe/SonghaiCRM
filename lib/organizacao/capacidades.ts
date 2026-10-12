/**
 * AS CAPACIDADES DA ORGANIZAÇÃO — o que ESTA empresa ligou para si.
 *
 * Irmã de `lib/instalacao/modulos.ts`, em outro nível: módulo opcional é
 * decisão da INSTALAÇÃO (o dono do servidor); capacidade é decisão da
 * ORGANIZAÇÃO (o administrador da empresa). A doutrina de extensões diz a
 * mesma coisa: "a instância decide o pacote; a organização decide o uso".
 *
 * Só o booleano `true` liga. Ausente, malformado, string ou erro de banco =
 * desligado: falha fechada, como `modulosLigados()`. Nunca lança — roda no
 * layout de `/app` e no turno do agente, e um throw ali derruba a tela ou o
 * atendimento.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { modulosLigados, type ModuloOpcional } from "@/lib/instalacao/modulos";
import { logger } from "@/lib/logger";
import {
  funcionalidadesDaOrganizacao,
  type FuncionalidadeDoPlano,
} from "@/lib/plans/funcionalidades";

export const CAPACIDADES_DA_ORGANIZACAO = ["propostas"] as const;
/** As que a EMPRESA liga para si (`organizations.settings`). */
export type CapacidadeLigadaPelaEmpresa = (typeof CAPACIDADES_DA_ORGANIZACAO)[number];
/**
 * Capacidade = o que a empresa ligou + o que o PACOTE dela inclui
 * (`lib/plans/funcionalidades.ts`). Os dois chegam pelo mesmo canal — menu, ⌘K,
 * catálogo MCP, ferramentas do agente — e é por isso que o plano que não inclui
 * a agenda a tira de todos eles de uma vez.
 */
export type CapacidadeDaOrganizacao = CapacidadeLigadaPelaEmpresa | FuncionalidadeDoPlano;

/**
 * O módulo da INSTALAÇÃO que cada capacidade exige (doc 79). A empresa liga a
 * dela; com o módulo desligado no servidor, a chave da empresa não liga nada —
 * e é aqui, e não em cada consumidor, que as duas se somam: tela, menu, rota,
 * ferramenta do agente e cron leem a mesma resposta.
 */
const MODULO_DA_CAPACIDADE: Record<CapacidadeLigadaPelaEmpresa, ModuloOpcional> = {
  propostas: "propostas",
};

function objeto(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * `organizations.settings` + os módulos ligados na instalação → as
 * capacidades ligadas. Pura; nunca lança.
 */
export function capacidadesLigadas(
  settings: unknown,
  modulos: readonly ModuloOpcional[],
  /**
   * O que o pacote inclui. Omitido = nenhuma: esta função continua a responder
   * só "o que a empresa ligou". Quem precisa do plano (o layout, a leitura
   * assíncrona abaixo) passa-o — e o que é omitido some do menu, nunca aparece.
   */
  funcionalidades: readonly FuncionalidadeDoPlano[] = [],
): CapacidadeDaOrganizacao[] {
  const propostas = objeto(objeto(settings)?.proposals);
  const daEmpresa: CapacidadeLigadaPelaEmpresa[] = propostas?.enabled === true ? ["propostas"] : [];
  return [...daEmpresa.filter((c) => modulos.includes(MODULO_DA_CAPACIDADE[c])), ...funcionalidades];
}

/** Lê a linha da organização. Nunca lança: erro = nenhuma capacidade DA EMPRESA (as do pacote seguem o plano). */
export async function capacidadesDaOrganizacao(
  db: SupabaseClient,
  organizationId: string,
): Promise<CapacidadeDaOrganizacao[]> {
  // O plano é lido à parte e nunca lança: se a leitura da empresa falhar, o
  // atendimento do pacote não cai junto (as funcionalidades falham ABERTAS).
  const funcionalidades = await funcionalidadesDaOrganizacao(db, organizationId);
  try {
    const [{ data, error }, modulos] = await Promise.all([
      db.from("organizations").select("settings").eq("id", organizationId).maybeSingle(),
      modulosLigados(db),
    ]);
    if (error) {
      logger.warn("capacidades da organização: leitura recusada — tratando todas como desligadas", {
        organization_id: organizationId,
        detalhe: (error as { message?: string }).message,
      });
      return [...funcionalidades];
    }
    return capacidadesLigadas((data as { settings?: unknown } | null)?.settings, modulos, funcionalidades);
  } catch (erro) {
    logger.warn("capacidades da organização: leitura falhou — tratando todas como desligadas", {
      organization_id: organizationId,
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
    return [...funcionalidades];
  }
}
