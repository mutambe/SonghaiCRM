/**
 * O PERFIL DO PAÍS DA ORGANIZAÇÃO — o documento do titular, a lei citada, o
 * calendário do prazo e os padrões de dado pessoal que o anonimizador redige.
 *
 * ─── Por que por ORGANIZAÇÃO, e não por instalação ─────────────────────────
 *
 * Duas organizações no mesmo banco podem estar em países diferentes, e cada
 * uma vê o documento, a lei e o prazo do país DELA. Um `.env` (`APP_COUNTRY`)
 * não sabe disso: ele responde por processo, e o processo serve todas as
 * organizações. A coluna `organizations.country` (ISO-3166 alpha-2, `null` =
 * Moçambique nesta distribuição) é a resposta; este módulo é quem a lê.
 *
 * ─── Por que uma função, e não `select` inline em cada rota ───────────────
 *
 * Mesmo motivo escrito no cabeçalho de `lib/catalogo/moeda-da-org.ts`: são
 * vários consumidores (validador do contato, importação por planilha,
 * anonimizador, PDF de acesso, página de privacidade, prazo do SLA) e duas
 * leituras inline divergem no dia em que uma ganhar fallback e a outra não.
 * A divergência aqui seria pior do que no catálogo: um documento afirmaria a
 * lei de um país e o prazo seria contado pelo calendário de outro.
 *
 * ─── A régua para um país ENTRAR (lida da issue #1033) ────────────────────
 *
 * "País entra na lista com a citação revisada, ou não entra." O PDF de acesso
 * responde a um direito legal do titular, e citar a lei errada — ou o artigo
 * errado — é pior do que não citar artigo nenhum. Por isso:
 *
 *   • `lei.revisada === false` (ou `lei === null`) faz o documento NÃO citar
 *     lei nenhuma. Não há fallback para a lei brasileira: afirmar a LGPD para
 *     um titular em Angola é exatamente a citação errada;
 *   • `paisesOferecidos()` — a lista que o seletor de Configurações mostra —
 *     só inclui país com citação revisada. O registro pode conhecer mais
 *     países do que a lista oferece; é o que permite preparar o trabalho sem
 *     publicar o que ninguém revisou.
 *
 * ─── A separação documento × forma (regra adotada do #928) ────────────────
 *
 * Não se inventa dígito verificador. País com checksum público documentado
 * (o mod-11 do CPF, no upstream) confere o dígito; país sem checksum — como
 * Moçambique, cujo NUIT não tem algoritmo público — valida
 * FORMA e a `regra` do perfil diz isso com todas as letras, para que a
 * mensagem de erro não prometa uma garantia que o validador não dá.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { HOLIDAYS_MZ_ISO } from "@/lib/lgpd/holidays-mz";
import { HOLIDAYS_PT_ISO } from "@/lib/lgpd/holidays-pt";

/** ISO-3166 alpha-2, em maiúsculas. `null`/vazio na coluna significa Moçambique. */
export type CodigoDePais = string;

/**
 * Um padrão de dado pessoal que ESTE país redige antes de a conversa ir para o
 * modelo de IA.
 *
 * `fonte` é a regex em texto, e não um `RegExp` montado: quem consome precisa
 * de instância nova por chamada — o `lastIndex` do `/g` atravessa `.test()` e
 * corrompe a guarda de vazamento (mesma razão anotada em
 * `lib/ai/anonymize/index.ts`).
 */
export interface PadraoDePiiDoPais {
  /** Rótulo do tipo, o mesmo que aparece no marcador: `[NUIT]`, `[BI]`. */
  tipo: string;
  /** Marcador que substitui o dado no texto anonimizado, com colchetes. */
  marcador: string;
  /** A regex, em texto, sem as flags. Cada consumidor cria a instância. */
  fonte: string;
  /**
   * O que este padrão **não** cobre. A issue #1033 exige a declaração: um
   * padrão largo demais redige número de pedido e cria ruído no RAG; largo de
   * menos deixa o documento chegar ao modelo — e os dois defeitos são
   * silenciosos sem esta linha escrita.
   */
  naoCobre: string;
}

export interface DocumentoDoTitular {
  /** O rótulo da tela: "NUIT", "Documento". */
  rotulo: string;
  /** Exemplo mostrado no formulário e nas mensagens. */
  exemplo: string;
  /** O que a validação GARANTE. Vai para a mensagem de erro. */
  regra: string;
  /**
   * A mensagem de erro pronta, por país. É texto de produto, e não remendo de
   * `regra`: país sem checksum público precisa DIZER que a validação é de
   * forma (a issue exige), e o texto brasileiro continua `CPF inválido`, o de
   * sempre, para não mexer no que quem já usa conhece.
   */
  mensagemInvalido: string;
  /** `true` quando o validador confere dígito verificador, e não só a forma. */
  confereDigito: boolean;
  /**
   * Cabeçalhos de planilha que apontam para este documento, JÁ normalizados
   * como `normalizaHeader` de `lib/contacts/csv.ts` os entrega (sem acento, em
   * minúsculas, separador `_`): quem importa tem "CPF" no Excel brasileiro e
   * "Bilhete de Identidade" no angolano. A coluna do banco continua `cpf` — o
   * vocabulário de TELA muda, o schema não (decisão escrita na issue #1033).
   */
  apelidosDoCabecalho: readonly string[];
  /** Valida o valor como o usuário digitou. */
  valida(valor: string): boolean;
  /** Como o valor é GRAVADO (a planilha não decide o formato do banco). */
  normaliza(valor: string): string;
}

export interface LeiCitada {
  /** Sigla pela qual a lei é conhecida: "LGPD", "GDPR". */
  nome: string;
  /** Número e data, como se cita em documento: "Lei nº 13.709/2018". */
  numero: string;
  /** O dispositivo do direito de acesso: "Art. 18, II". */
  artigo: string;
  /**
   * Revisão jurídica local feita por quem pode revisar. Enquanto for `false`,
   * o documento não cita esta lei (ver cabeçalho).
   */
  revisada: boolean;
}

export interface CalendarioDeDiasUteis {
  /** Datas `YYYY-MM-DD` dos feriados nacionais, no formato de `holidays-mz.ts`. */
  feriados: readonly string[];
  /** Como o calendário se apresenta ao operador: "feriados nacionais brasileiros". */
  rotulo: string;
}

export interface PerfilDoPais {
  /** ISO-3166 alpha-2, maiúsculas. */
  codigo: CodigoDePais;
  /** Nome do país como o operador o lê. */
  nome: string;
  documento: DocumentoDoTitular;
  /**
   * Um telefone DESTE país em E.164, para o exemplo dos formulários.
   *
   * Mora aqui porque o campo é o mesmo em toda tela e o exemplo não é: o
   * `+5511999998888` escrito em duro em `NewContactDialog` ensinava DDI
   * brasileiro a quem cadastra cliente em Lisboa. País novo declara o seu.
   */
  telefoneExemplo: string;
  /** `null` quando o país ainda não tem lei revisada para citar. */
  lei: LeiCitada | null;
  calendario: CalendarioDeDiasUteis;
  /** Padrões PRÓPRIOS do país; e-mail/telefone são universais e moram fora. */
  padroesDePii: readonly PadraoDePiiDoPais[];
}

/**
 * Moçambique é o país desta distribuição (SonghaiCRM): `null` na coluna
 * `organizations.country` vale este perfil. O perfil brasileiro do upstream
 * não está no registro — nada aqui é referente ao Brasil (decisão do dono do
 * produto, 2026-09-30; ver docs/upstream-sync.md).
 */
export const PAIS_PADRAO: CodigoDePais = "MZ";

/**
 * NUIT (Número Único de Identificação Tributária) — 9 dígitos.
 *
 * Valida FORMA, e diz isso na `regra`: o NUIT não tem algoritmo de dígito
 * verificador publicamente documentado, e inventar um seria pior do que não
 * ter nenhum (recusaria NUIT válido ou aceitaria inválido com falsa
 * confiança — a regra do #928 que o cabeçalho cita). Recusa só a sequência de
 * um dígito repetido (000000000, 111111111…), que é sempre preenchimento.
 */
export function isValidNuit(raw: string): boolean {
  const s = raw.replace(/\D/g, "");
  return /^\d{9}$/.test(s) && !/^(\d)\1{8}$/.test(s);
}

/**
 * O mod-11 do NIF português — o dígito de controlo da Autoridade Tributária,
 * algoritmo público (não é checksum inventado; respeita a régua do #928).
 *
 * Para os oito primeiros dígitos valem os pesos 9..2 (da esquerda para a
 * direita); o resto da soma módulo 11 decide o dígito: resto 0 ou 1 → `0`,
 * senão `11 - resto`. O nono dígito tem de bater com esse cálculo.
 */
export function isValidNif(raw: string): boolean {
  const s = raw.replace(/\D/g, "");
  if (!/^\d{9}$/.test(s) || /^(\d)\1{8}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += parseInt(s[i]!, 10) * (9 - i);
  const resto = sum % 11;
  const digito = resto < 2 ? 0 : 11 - resto;
  return digito === parseInt(s[8]!, 10);
}

const DOCUMENTO_MZ: DocumentoDoTitular = {
  rotulo: "NUIT",
  exemplo: "123456789",
  regra: "9 dígitos (o NUIT não tem dígito verificador público: confere-se a forma)",
  mensagemInvalido: "NUIT inválido (9 dígitos)",
  confereDigito: false,
  apelidosDoCabecalho: ["nuit", "numero_unico_de_identificacao_tributaria"],
  valida: isValidNuit,
  normaliza: (valor) => valor.replace(/\D/g, ""),
};

const PERFIL_MZ: PerfilDoPais = {
  codigo: "MZ",
  nome: "Moçambique",
  documento: DOCUMENTO_MZ,
  telefoneExemplo: "+258841234567",
  lei: {
    // A base legal que o produto cita desde o fork: Lei n.º 3/2017 (Lei de
    // Transacções Electrónicas), que traz a proteção de dados pessoais. O
    // artigo fica VAZIO de propósito — citar um dispositivo não revisado num
    // documento que responde a direito legal é pior do que não citar artigo
    // (ver o cabeçalho). `citacaoDaLei` produz "Lei n.º 3/2017 (Moçambique)".
    nome: "Lei n.º 3/2017",
    numero: "Lei n.º 3/2017",
    artigo: "",
    revisada: true,
  },
  calendario: {
    feriados: HOLIDAYS_MZ_ISO,
    rotulo: "feriados nacionais moçambicanos",
  },
  padroesDePii: [
    {
      // O telefone MOÇAMBICANO vem primeiro e tem tipo próprio — não "phone" —
      // de propósito: `padroesDePii` deduplica por tipo, e o padrão universal
      // "phone" (forma brasileira: DDD + 9 + 4-5 + 4) precisa continuar valendo
      // para número estrangeiro. Medido: o universal NÃO pega `84 123 4567` nem
      // `+258 84 123 4567`, e o número do cliente ia cru para o modelo de IA.
      tipo: "telefone_mz",
      marcador: "[TELEFONE]",
      fonte:
        "(?<![\\d+])(?:\\+?258[\\s.-]?)?(?:8[2-7](?:[\\s.-]?\\d){7}|2[1-9](?:[\\s.-]?\\d){6})(?!\\d)",
      naoCobre: "telefone estrangeiro (fica com o padrão universal) e número escrito por extenso",
    },
    {
      tipo: "nuit",
      marcador: "[NUIT]",
      fonte: "\\b\\d{9}\\b",
      naoCobre: "NUIT escrito com separadores entre os dígitos",
    },
    {
      tipo: "bi",
      marcador: "[BI]",
      fonte: "\\b\\d{12}[A-Z]\\b",
      naoCobre: "Bilhete de Identidade com espaços ou com a letra em minúscula",
    },
  ],
};

const DOCUMENTO_PT: DocumentoDoTitular = {
  rotulo: "NIF",
  exemplo: "123 456 789",
  regra: "dígito de controlo (mod-11 da Autoridade Tributária)",
  mensagemInvalido: "NIF inválido",
  confereDigito: true,
  apelidosDoCabecalho: ["nif", "contribuinte"],
  valida: isValidNif,
  normaliza: (valor) => valor.replace(/\D/g, ""),
};

const PERFIL_PT: PerfilDoPais = {
  codigo: "PT",
  nome: "Portugal",
  documento: DOCUMENTO_PT,
  telefoneExemplo: "+351912345678",
  lei: {
    nome: "RGPD",
    numero: "Regulamento (UE) 2016/679",
    artigo: "art. 15.º",
    revisada: false,
  },
  calendario: {
    feriados: HOLIDAYS_PT_ISO,
    rotulo: "feriados nacionais portugueses",
  },
  padroesDePii: [
    {
      tipo: "nif",
      marcador: "[NIF]",
      fonte: "\\b\\d{9}\\b",
      naoCobre:
        "NIF com menos de 9 dígitos e número de telemóvel português de 9 dígitos — sem o prefixo `+351` o padrão não distingue um do outro",
    },
    {
      tipo: "codigoPostal",
      marcador: "[CODIGO_POSTAL]",
      fonte: "\\b\\d{4}-\\d{3}\\b",
      naoCobre:
        "código postal sem hífen e código estrangeiro (CEP brasileiro usa ponto e 8 dígitos)",
    },
  ],
};

/**
 * O registro de países conhecidos.
 *
 * ⚠️ Conhecer ≠ oferecer. A lista que o operador escolhe é
 * `paisesOferecidos()`, e ela exige `lei.revisada`. Nesta distribuição há um
 * país só, Moçambique; o mecanismo do upstream continua inteiro para quem
 * quiser preparar outro sem publicar citação não revisada.
 *
 * Exportado mutável de propósito: os testes de tabela registram um país
 * sintético para provar o mecanismo sem publicar citação não revisada.
 */
export const PERFIS_DO_PAIS: Record<CodigoDePais, PerfilDoPais> = {
  MZ: PERFIL_MZ,
  PT: PERFIL_PT,
};

/** O perfil de um código; vazio ou desconhecido degrada para Moçambique. */
export function perfilDoPais(codigo: CodigoDePais | null | undefined): PerfilDoPais {
  const chave = (codigo ?? "").trim().toUpperCase();
  if (chave === "") return PERFIS_DO_PAIS[PAIS_PADRAO]!;
  return PERFIS_DO_PAIS[chave] ?? PERFIS_DO_PAIS[PAIS_PADRAO]!;
}

/** O que o seletor de Configurações › Empresa oferece. */
export function paisesOferecidos(): PerfilDoPais[] {
  return Object.values(PERFIS_DO_PAIS)
    .filter((p) => p.lei?.revisada === true)
    .sort((a, b) => a.nome.localeCompare(b.nome));
}

/** A citação pronta para o documento, ou `null` quando não há lei revisada. */
export function citacaoDaLei(perfil: PerfilDoPais): string | null {
  const lei = perfil.lei;
  if (!lei || !lei.revisada) return null;
  // Sem artigo revisado, cita a lei e o país — "Lei n.º 3/2017 (Moçambique)".
  const artigo = lei.artigo.trim();
  if (!artigo) return `${lei.numero} (${perfil.nome})`;
  return `${lei.nome} ${artigo} (${lei.numero})`;
}

/**
 * O perfil do país da ORGANIZAÇÃO.
 *
 * Degrada para Moçambique quando a linha da organização não vem (RLS negando,
 * linha removida no meio da requisição) — é o mesmo valor que a coluna vazia
 * representa, ou seja, o comportamento de antes desta feature. Derrubar um
 * cadastro de contato porque a leitura de um campo de configuração falhou
 * seria trocar um rótulo errado por um formulário que não salva (doutrina do
 * `moeda-da-org`). O silêncio, porém, deixa RASTRO: sem ele, uma organização
 * em outro país segue afirmando a lei moçambicana sem que ninguém perceba.
 */
export async function perfilDaOrganizacao(
  supabase: SupabaseClient,
  orgId: string,
): Promise<PerfilDoPais> {
  const { data, error } = await supabase
    .from("organizations")
    .select("country")
    .eq("id", orgId)
    .maybeSingle();

  const declarado = (data as { country?: string | null } | null)?.country ?? null;
  const perfil = perfilDoPais(declarado);

  const chave = (declarado ?? "").trim().toUpperCase();
  if (chave !== "" && !PERFIS_DO_PAIS[chave]) {
    const motivo = `país ${chave} não tem perfil revisado; valendo ${perfil.codigo}`;
    console.error("[perfil-do-pais] caiu no padrão", { orgId, motivo });
    void import("@sentry/nextjs")
      .then((Sentry) => {
        Sentry.captureMessage(`[perfil-do-pais] ${motivo}`, {
          level: "warning",
          tags: { subsystem: "legal" },
          extra: { organization_id: orgId },
        });
      })
      .catch(() => {
        /* sem Sentry configurado: o console.error acima é o que resta */
      });
  } else if (error) {
    console.error("[perfil-do-pais] caiu no padrão", { orgId, motivo: error.message });
  }

  return perfil;
}
