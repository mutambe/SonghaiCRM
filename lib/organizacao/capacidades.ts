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
import { telefoniaEmUso } from "@/lib/telefonia/em-uso";
import {
  funcionalidadesDaOrganizacao,
  type FuncionalidadeDoPlano,
} from "@/lib/plans/funcionalidades";

/**
 * `telefonia` entrou pela issue #1290: a tela Chamadas (`/app/calls`) aparecia no
 * menu de todo mundo e levava a uma tela vazia para quem nunca ligou o módulo.
 * Ela é uma capacidade da ORGANIZAÇÃO, com o mesmo desenho de `propostas` — não
 * uma segunda régua: o menu lê `capacidades_ligadas` e mais nada.
 */
export const CAPACIDADES_DA_ORGANIZACAO = ["propostas", "telefonia"] as const;
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
 *
 * `null` quando NÃO existe chave de instalação que o app possa ler: a telefonia
 * entra pelo profile `telefonia` do `COMPOSE_PROFILES`, que só o Docker lê. Nesse
 * caso a capacidade se resolve pelo sinal da própria organização, e o `null` está
 * escrito para que ninguém procure uma chave que não existe em `platform_config`.
 */
const MODULO_DA_CAPACIDADE: Record<CapacidadeLigadaPelaEmpresa, ModuloOpcional | null> = {
  propostas: "propostas",
  telefonia: null,
};

function objeto(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * `organizations.settings` + os módulos ligados na instalação + o sinal de
 * telefonia da organização → as capacidades ligadas. Pura; nunca lança.
 *
 * `telefoniaEmUsoDaOrganizacao` entra como PARÂMETRO, e não de dentro do
 * `settings`, porque o sinal não mora lá: mora na linha de `voip_trunk_settings`
 * que o cliente salvou (ver `lib/telefonia/em-uso.ts`). Quem já tem o dado em
 * mãos não paga uma consulta; quem não tem usa `capacidadesDaOrganizacao()`.
 * O padrão `false` mantém intacto todo chamador que só pergunta por propostas
 * (os crons do doc 79).
 */
export function capacidadesLigadas(
  settings: unknown,
  modulos: readonly ModuloOpcional[],
  telefoniaEmUsoDaOrganizacao = false,
  /**
   * O que o pacote inclui. Omitido = nenhuma: esta função continua a responder
   * só "o que a empresa ligou". Quem precisa do plano (o layout, a leitura
   * assíncrona abaixo) passa-o — e o que é omitido some do menu, nunca aparece.
   */
  funcionalidades: readonly FuncionalidadeDoPlano[] = [],
): CapacidadeDaOrganizacao[] {
  const daEmpresa: CapacidadeDaOrganizacao[] = [];
  const propostas = objeto(objeto(settings)?.proposals);
  const moduloDePropostas = MODULO_DA_CAPACIDADE.propostas;
  if (propostas?.enabled === true && moduloDePropostas && modulos.includes(moduloDePropostas)) {
    daEmpresa.push("propostas");
  }
  // Sem módulo de instalação (`null`): a decisão é só da organização, e o sinal
  // é o tronco salvo. Com o profile `telefonia` desligado no servidor a tela
  // também não funciona — mas esse estado o app não enxerga, e fingir que
  // enxerga seria pior que o defeito.
  if (telefoniaEmUsoDaOrganizacao) daEmpresa.push("telefonia");
  return [...daEmpresa, ...funcionalidades];
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
    const [{ data, error }, modulos, telefonia] = await Promise.all([
      db.from("organizations").select("settings").eq("id", organizationId).maybeSingle(),
      modulosLigados(db),
      telefoniaEmUso(db, organizationId),
    ]);
    if (error) {
      logger.warn("capacidades da organização: leitura recusada — tratando todas como desligadas", {
        organization_id: organizationId,
        detalhe: (error as { message?: string }).message,
      });
      return [...funcionalidades];
    }
    return capacidadesLigadas((data as { settings?: unknown } | null)?.settings, modulos, telefonia, funcionalidades);
  } catch (erro) {
    logger.warn("capacidades da organização: leitura falhou — tratando todas como desligadas", {
      organization_id: organizationId,
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
    return [...funcionalidades];
  }
}
