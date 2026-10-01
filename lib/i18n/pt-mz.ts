/**
 * PORTUGUÊS DE MOÇAMBIQUE — a camada sobre o texto do produto.
 *
 * ─── Por que uma camada, e não um dicionário frase a frase ─────────────────
 *
 * O texto das telas nasce em português do Brasil no upstream (DeskcommCRM), e
 * passa TODO por `t()` — o upstream tem um guarda que reprova prosa fora dele.
 * Um dicionário frase a frase para Moçambique teria milhares de entradas quase
 * iguais à fonte, e envelheceria a cada tela nova do upstream. Esta camada
 * aplica a diferença entre as duas normas a qualquer texto que passe por
 * `t()`, inclusive os que o upstream ainda vai escrever. O que nenhuma regra
 * acerta com segurança vai escrito por inteiro em `./frases-pt-mz.ts`.
 *
 * ─── O que ela troca, em ordem ─────────────────────────────────────────────
 *
 *  1. Frases fixas: "aguardando você" → "à sua espera", "Cidade/UF".
 *  2. Gerúndio, nas três posições em que Moçambique diz «a» + infinitivo:
 *     - progressivo: "está esperando" → "está a esperar" (com o pronome:
 *       "está se repetindo" → "está a repetir-se");
 *     - rótulo que abre o texto ou a frase: "Aguardando aprovação" →
 *       "A aguardar aprovação";
 *     - verbo de ESTADO depois de um nome: "conversa aguardando responsável"
 *       → "conversa a aguardar responsável". Lista fechada: o gerúndio de
 *       MODO ("responda usando o modelo") é português europeu correto e fica.
 *  3. Nome que muda de gênero, com o determinante e o adjetivo que concordam:
 *     "nesta tela aberta" → "neste ecrã aberto"; "o time" → "a equipa";
 *     "o aplicativo" → "a aplicação"; "o banco de dados" → "a base de dados".
 *  4. Vocabulário de mesmo gênero: contato → contacto, senha → palavra-passe…
 *  5. Artigo antes do possessivo, como se escreve em Moçambique: "Sua conta"
 *     → "A sua conta", "de seu" → "do seu", "veja seus dados" → "veja os
 *     seus dados" (não depois de "é"/"são", nem em "em seu nome").
 *  6. "acessar X" → "aceder a X" (o verbo europeu pede a preposição).
 *  7. "precisa ser" → "precisa de ser" (mas "é preciso reindexar" fica).
 *  8. Pronome reflexivo depois do verbo: "Esta página se atualiza" →
 *     "Esta página atualiza-se" — salvo quando algo na oração o atrai para
 *     antes ("Como a IA se comporta", "o que você me contou").
 *  9. Ajustes literais: concordância à distância que a troca de gênero não
 *     alcança ("os ecrãs ficam vazias" → "vazios") e casos únicos.
 *
 * Frases que nenhuma dessas regras acerta ("a gente resolve", exemplos com
 * Pix) vão escritas por inteiro em `./frases-pt-mz.ts`.
 *
 * ─── O que ela NÃO faz, de propósito ───────────────────────────────────────
 *
 * Não reescreve "você" (é usado em Moçambique) nem o gerúndio de modo, e não
 * troca palavra cujo sentido muda com o contexto ("pegar", "a gente",
 * "conexão" — esta é palavra portuguesa válida). Trocar errado é pior do que
 * deixar a variante brasileira, que o leitor moçambicano entende. Cada regra
 * tem caso em `tests/unit/i18n-portugues-de-mocambique.test.ts`.
 */

/** Palavras de mesmo gênero, trocadas com a palavra INTEIRA (borda Unicode). */
const PALAVRAS: ReadonlyArray<readonly [string, string]> = [
  ["contato", "contacto"],
  ["contatos", "contactos"],
  ["contatar", "contactar"],
  ["contate", "contacte"],
  ["contatou", "contactou"],
  ["cadastro", "registo"],
  ["cadastros", "registos"],
  ["cadastrar", "registar"],
  ["cadastra", "regista"],
  ["cadastram", "registam"],
  ["cadastrou", "registou"],
  ["cadastraram", "registaram"],
  ["cadastrado", "registado"],
  ["cadastrada", "registada"],
  ["cadastrados", "registados"],
  ["cadastradas", "registadas"],
  ["cadastre", "registe"],
  ["registro", "registo"],
  ["registros", "registos"],
  ["registrar", "registar"],
  ["registra", "regista"],
  ["registram", "registam"],
  ["registrou", "registou"],
  ["registraram", "registaram"],
  ["registramos", "registamos"],
  ["registre", "registe"],
  ["registrei", "registei"],
  ["registrado", "registado"],
  ["registrada", "registada"],
  ["registrados", "registados"],
  ["registradas", "registadas"],
  ["arquivo", "ficheiro"],
  ["arquivos", "ficheiros"],
  ["celular", "telemóvel"],
  ["celulares", "telemóveis"],
  ["salvar", "guardar"],
  ["salvo", "guardado"],
  ["salva", "guardada"],
  ["salvos", "guardados"],
  ["salvas", "guardadas"],
  ["compartilhar", "partilhar"],
  ["compartilhado", "partilhado"],
  ["compartilhada", "partilhada"],
  ["usuário", "utilizador"],
  ["usuários", "utilizadores"],
  ["equipe", "equipa"],
  ["equipes", "equipas"],
  ["baixar", "transferir"],
  ["baixado", "transferido"],
  ["escanear", "digitalizar"],
  ["escaneie", "digitalize"],
  ["digite", "introduza"],
  ["oi", "olá"],
  ["senha", "palavra-passe"],
  ["senhas", "palavras-passe"],
  ["parcela", "prestação"],
  ["parcelas", "prestações"],
  ["mídia", "multimédia"],
  ["mídias", "multimédia"],
  // "Excluir" é o botão de apagar; "exclusão" fica (também é "excluído da campanha").
  ["excluir", "eliminar"],
  ["exclua", "elimine"],
  ["excluam", "eliminem"],
  ["excluiu", "eliminou"],
  ["excluíram", "eliminaram"],
  ["excluído", "eliminado"],
  ["excluída", "eliminada"],
  ["excluídos", "eliminados"],
  ["excluídas", "eliminadas"],
  ["deletar", "eliminar"],
  ["deletado", "eliminado"],
  ["deletada", "eliminada"],
  ["seção", "secção"],
  ["seções", "secções"],
  ["fato", "facto"],
  ["fatos", "factos"],
  ["gerenciar", "gerir"],
  ["gerencia", "gere"],
  ["gerenciado", "gerido"],
  ["gerenciada", "gerida"],
  ["gerenciados", "geridos"],
  ["gerenciadas", "geridas"],
  ["gerenciador", "gestor"],
  ["gerenciadores", "gestores"],
  ["planilha", "folha de cálculo"],
  ["planilhas", "folhas de cálculo"],
  ["checar", "verificar"],
  ["checa", "verifica"],
  ["checou", "verificou"],
  // Software "roda" no Brasil; em Moçambique, "corre".
  ["rodar", "correr"],
  ["roda", "corre"],
  ["rodam", "correm"],
  ["rodou", "correu"],
  ["rodaram", "correram"],
  ["rodando", "executando"],
  ["pegar", "apanhar"],
  ["pega", "apanha"],
  ["pegam", "apanham"],
  ["pegou", "apanhou"],
  ["pegue", "apanhe"],
  ["peguem", "apanhem"],
  // Gerúndio de MODO dos verbos trocados acima (o de estado já vira «a» + infinitivo).
  ["registrando", "registando"],
  ["cadastrando", "registando"],
  ["salvando", "guardando"],
  ["compartilhando", "partilhando"],
  ["baixando", "transferindo"],
  ["gerenciando", "gerindo"],
  ["coletando", "recolhendo"],
  ["buscando", "procurando"],
  // "excluindo" fica: no gerúndio quase sempre é "exceto" ("excluindo os arquivados").
  ["gerencie", "gira"],
  ["rode", "corra"],
  ["rodem", "corram"],
  ["coletar", "recolher"],
  ["coleta", "recolha"],
  ["coletas", "recolhas"],
  ["coletado", "recolhido"],
  ["coletada", "recolhida"],
  ["coletados", "recolhidos"],
  ["coletadas", "recolhidas"],
  ["esfriar", "arrefecer"],
  ["esfria", "arrefece"],
  ["esfriou", "arrefeceu"],
  ["buscar", "procurar"],
  ["busque", "procure"],
  ["busca", "pesquisa"],
  ["buscas", "pesquisas"],
  // O documento do titular e o da empresa, em Moçambique, é o NUIT (mesmo gênero).
  ["cpf", "NUIT"],
  ["cnpj", "NUIT"],
  ["pra", "para"],
];

const L = "\\p{L}\\p{N}_";
const palavra = (fonte: string, flags = "giu") => new RegExp(`(?<![${L}])(?:${fonte})(?![${L}])`, flags);

/** Mantém a caixa da primeira letra (e a caixa toda, se a fonte for maiúscula). */
function comCaixaDe(fonte: string, alvo: string): string {
  if (fonte.length > 1 && fonte === fonte.toUpperCase()) return alvo.toUpperCase();
  const primeira = fonte.charAt(0);
  return primeira === primeira.toUpperCase() && primeira !== primeira.toLowerCase()
    ? alvo.charAt(0).toUpperCase() + alvo.slice(1)
    : alvo;
}

const MAPA_DE_PALAVRAS = new Map(PALAVRAS.map(([de, para]) => [de, para]));
const TODAS_AS_PALAVRAS = palavra(PALAVRAS.map(([de]) => de).sort((a, b) => b.length - a.length).join("|"));

function trocarPalavras(texto: string): string {
  return texto.replace(TODAS_AS_PALAVRAS, (achado) => comCaixaDe(achado, MAPA_DE_PALAVRAS.get(achado.toLowerCase())!));
}

// ─── 1. Frases fixas ──────────────────────────────────────────────────────

const FRASES_FIXAS: ReadonlyArray<readonly [RegExp, string]> = [
  [palavra("(?:aguardando|esperando)(?: por)? você"), "à sua espera"],
  // O texto trata o leitor por "você": o "te" brasileiro vira "lhe"/"sua".
  [palavra("te esperando"), "à sua espera"],
  [palavra("quem te convidou"), "quem lhe enviou o convite"],
  [palavra("que te convidou"), "que lhe enviou o convite"],
  [palavra("te deu"), "lhe deu"],
  [palavra("te ligar"), "lhe ligar"],
  // "pegar a chave" é obtê-la; o resto de "pegar" vira "apanhar" (vocabulário).
  [palavra("pegar a chave"), "obter a chave"],
  [palavra("pegar uma chave"), "obter uma chave"],
  [palavra("convite de time"), "convite de equipa"],
  [palavra("time de atendimento"), "equipa de atendimento"],
  [palavra("time humano"), "equipa humana"],
  [/Você\/time/g, "Você/equipa"],
  [palavra("dados cadastrais"), "dados de registo"],
  [/Cidade\/UF/g, "Cidade/Província"],
  // "em outra equipa" → "noutra equipa": a contração é a norma europeia.
  // Programa "rodando na máquina" corre; "resolve rodando o update.sh" executa.
  [palavra("rodando na"), "a correr na"],
  [palavra("rodando no"), "a correr no"],
  [palavra("em um"), "num"],
  [palavra("em uma"), "numa"],
  [palavra("em uns"), "nuns"],
  [palavra("em umas"), "numas"],
  [palavra("em outro"), "noutro"],
  [palavra("em outra"), "noutra"],
  [palavra("em outros"), "noutros"],
  [palavra("em outras"), "noutras"],
];

/**
 * "precisa ser" → "precisa de ser": em Moçambique, "precisar" pede "de" antes
 * do infinitivo. O segundo termo tem de ser verbo — "lugar", "melhor" e "valor"
 * também terminam em -ar/-or e ficam.
 */
const PRECISAR = new RegExp(
  `(?<![${L}])(precis(?:a|am|o|amos|ava|avam|ar|e|em|ou|aram|aria|ará|arão|ando))(\\s+)(\\p{L}+(?:ar|er|ir|ôr|or))(?![${L}])`,
  "giu",
);
const NAO_E_INFINITIVO = new Set([
  "lugar", "mar", "par", "bar", "ar", "mulher", "colher", "qualquer", "melhor", "pior", "maior", "menor",
  "valor", "favor", "cor", "dor", "flor", "amor", "exterior", "interior", "anterior", "posterior",
  "superior", "inferior", "senhor", "setor", "autor", "ator", "fator", "motor", "sabor", "calor",
  "operador", "administrador", "utilizador", "servidor", "provedor", "fornecedor", "gestor", "por",
  "familiar", "particular", "popular", "regular", "similar",
]);

/** "é preciso reindexar" é a expressão impessoal (adjetivo), não o verbo: fica sem "de". */
const E_PRECISO = /(?:^|[^\p{L}])(é|era|foi|será|seria|fica|ficou|ser|está)\s+$/iu;

function precisarDe(texto: string): string {
  return texto.replace(PRECISAR, (achado, verbo: string, esp: string, inf: string, offset: number, todo: string) => {
    if (NAO_E_INFINITIVO.has(inf.toLowerCase())) return achado;
    if (verbo.toLowerCase() === "preciso" && E_PRECISO.test(todo.slice(Math.max(0, offset - 12), offset))) return achado;
    return `${verbo}${esp}de ${inf}`;
  });
}

// ─── 2. Gerúndio ──────────────────────────────────────────────────────────

/** Terminam em -ndo e não são gerúndio (ou são, mas mudam de sentido). */
const NAO_E_GERUNDIO = new Set([
  "quando", "mundo", "segundo", "fundo", "comando", "redondo", "profundo", "lindo", "vindo",
  "tremendo", "horrendo", "estupendo", "dividendo", "adendo", "remendo", "imundo", "oriundo",
  "rotundo", "brando", "bando", "nefando", "infando", "fernando", "orlando", "rolando", "armando",
  "mando", "abundo",
]);

/** No começo da frase estes são de MODO ("Sendo assim", "Considerando que…"), não de estado. */
const GERUNDIO_DE_MODO_NO_INICIO = new Set(["sendo", "tendo", "considerando", "lembrando", "seguindo"]);

/** "esperando" → "esperar"; "pondo" → "pôr". `null` quando não é gerúndio. */
function infinitivo(gerundio: string): string | null {
  const g = gerundio.toLowerCase();
  if (NAO_E_GERUNDIO.has(g)) return null;
  const m = /^(\p{L}+?)(ando|endo|indo|ondo)$/u.exec(g);
  if (!m) return null;
  const [, raiz, sufixo] = m as unknown as [string, string, string];
  if (sufixo === "ondo") return `${raiz}or`.replace(/^por$/, "pôr");
  return raiz + { ando: "ar", endo: "er", indo: "ir" }[sufixo];
}

const GER = "\\p{L}+(?:ando|endo|indo|ondo)";
const AUXILIARES =
  "est[áa]|estão|estou|estamos|estava|estavam|estive|esteve|estiveram|esteja|estejam|estiver|estiverem|estivesse|estar|" +
  "fica|ficam|ficou|ficaram|ficar|fique|fiquem|ficará|continua|continuam|continuou|continuar|continue|continuem|" +
  "segue|seguem|seguir|siga|sigam|anda|andam";

/** "está esperando" / "está se repetindo" → "está a esperar" / "está a repetir-se". */
const PROGRESSIVO = new RegExp(
  `(?<![${L}])(${AUXILIARES})(\\s+)(?:(se|me|te|lhe|nos)\\s+)?(${GER})(?![${L}])`,
  "giu",
);

/** O gerúndio que abre o texto ou uma frase, em maiúscula: "Aguardando aprovação". */
const GERUNDIO_QUE_ABRE = new RegExp(`(^|[.!?…]\\s+|[—·:]\\s+)(\\p{Lu}\\p{Ll}+(?:ando|endo|indo|ondo))(?![${L}])`, "gu");

/** O texto inteiro é um gerúndio em minúscula: "carregando", "validando". */
const SO_O_GERUNDIO = /^(\p{Ll}+(?:ando|endo|indo))(…|\.\.\.)?$/u;

/** Verbos de ESTADO: depois de um nome, sem vírgula, viram «a» + infinitivo. */
// Fora da lista, de propósito: "rodando" ("resolve rodando o update.sh" é de modo) e
// "crescendo" ("vai crescendo" é português europeu correto).
const GERUNDIOS_DE_ESTADO =
  "aguardando|esperando|pedindo|vencendo|atendendo|faltando|chegando|funcionando|decidindo|" +
  "observando|falando|distribuindo|enviando|editando|conversando|processando|carregando|validando|" +
  "atualizando|sincronizando|preparando|terminando|recebendo";
const ESTADO_DEPOIS_DE_NOME = new RegExp(`(?<=[${L})]\\s)(${GERUNDIOS_DE_ESTADO})(?![${L}])`, "giu");

function trocarGerundios(texto: string): string {
  let s = texto.replace(PROGRESSIVO, (achado, aux: string, esp: string, pronome: string | undefined, ger: string) => {
    const inf = infinitivo(ger);
    if (!inf) return achado;
    return `${aux}${esp}a ${inf}${pronome ? `-${pronome.toLowerCase()}` : ""}`;
  });
  s = s.replace(GERUNDIO_QUE_ABRE, (achado, antes: string, ger: string, offset: number, todo: string) => {
    if (GERUNDIO_DE_MODO_NO_INICIO.has(ger.toLowerCase())) return achado;
    // "Arquivando, ele para…" / "Chegando mensagem nova, o relógio…": a oração que
    // termina em vírgula é de modo ou de condição, e o gerúndio é português europeu.
    const resto = todo.slice(offset + achado.length);
    if (/^[^.!?…—:;]*,/.test(resto)) return achado;
    const inf = infinitivo(ger);
    return inf ? `${antes}A ${inf}` : achado;
  });
  s = s.replace(SO_O_GERUNDIO, (achado, ger: string, reticencias: string | undefined) => {
    const inf = infinitivo(ger);
    return inf ? `a ${inf}${reticencias ?? ""}` : achado;
  });
  s = s.replace(ESTADO_DEPOIS_DE_NOME, (achado, ger: string) => {
    const inf = infinitivo(ger);
    return inf ? `a ${inf}` : achado;
  });
  return s;
}

// ─── 3. Nome que muda de gênero ───────────────────────────────────────────

/** Determinantes e adjetivos que vêm antes do nome: feminino ↔ masculino. */
const FEM_MASC: ReadonlyArray<readonly [string, string]> = [
  ["a", "o"], ["as", "os"], ["à", "ao"], ["às", "aos"], ["da", "do"], ["das", "dos"],
  ["na", "no"], ["nas", "nos"], ["pela", "pelo"], ["pelas", "pelos"], ["uma", "um"],
  ["umas", "uns"], ["numa", "num"], ["duma", "dum"], ["esta", "este"], ["estas", "estes"],
  ["essa", "esse"], ["essas", "esses"], ["aquela", "aquele"], ["nesta", "neste"],
  ["nessa", "nesse"], ["desta", "deste"], ["dessa", "desse"], ["daquela", "daquele"],
  ["naquela", "naquele"], ["sua", "seu"], ["suas", "seus"], ["minha", "meu"], ["nossa", "nosso"],
  ["nenhuma", "nenhum"], ["outra", "outro"], ["outras", "outros"], ["noutra", "noutro"],
  ["noutras", "noutros"], ["doutra", "doutro"], ["doutras", "doutros"], ["mesma", "mesmo"],
  ["própria", "próprio"], ["toda", "todo"], ["todas", "todos"], ["nova", "novo"],
  ["primeira", "primeiro"], ["última", "último"], ["única", "único"],
];
const PARA_MASC = new Map(FEM_MASC);
const PARA_FEM = new Map(FEM_MASC.map(([f, m]) => [m, f]));
/** Adjetivos que vêm DEPOIS e concordam — os particípios entram pela terminação. */
const ADJETIVOS_QUE_CONCORDAM = /^(\p{L}+(?:ad|id)|abert|nov|própri|extern|intern|chei|pront|inteir|únic|mesm|ativ|conectad|instalad)([oa]s?)$/u;

function flexionar(palavraFonte: string, mapa: Map<string, string>): string {
  const alvo = mapa.get(palavraFonte.toLowerCase());
  return alvo === undefined ? palavraFonte : comCaixaDe(palavraFonte, alvo);
}

function concordarAdjetivo(adj: string, para: "m" | "f"): string {
  const m = ADJETIVOS_QUE_CONCORDAM.exec(adj.toLowerCase());
  if (!m) return adj;
  const fim = m[2]!;
  const plural = fim.endsWith("s");
  const novoFim = (para === "m" ? "o" : "a") + (plural ? "s" : "");
  return adj.slice(0, adj.length - fim.length) + (adj === adj.toUpperCase() ? novoFim.toUpperCase() : novoFim);
}

interface TrocaDeGenero {
  /** Nome no singular e no plural, como aparecem na fonte. */
  singular: string;
  plural: string;
  /** O mesmo, em Moçambique. */
  para: [singular: string, plural: string];
  /** Gênero do nome de DESTINO. */
  generoNovo: "m" | "f";
  /** Só troca com determinante antes ("time" sozinho pode ser inglês). */
  exigeDeterminante?: boolean;
}

const TROCAS_DE_GENERO: TrocaDeGenero[] = [
  { singular: "tela", plural: "telas", para: ["ecrã", "ecrãs"], generoNovo: "m" },
  { singular: "aplicativo", plural: "aplicativos", para: ["aplicação", "aplicações"], generoNovo: "f" },
  { singular: "banco de dados", plural: "bancos de dados", para: ["base de dados", "bases de dados"], generoNovo: "f" },
  // No produto, "banco" sozinho é sempre a base de dados ("o banco recusou a gravação").
  { singular: "banco", plural: "bancos", para: ["base de dados", "bases de dados"], generoNovo: "f" },
  { singular: "time", plural: "times", para: ["equipa", "equipas"], generoNovo: "f", exigeDeterminante: true },
  // A aba do navegador é o "separador".
  { singular: "aba", plural: "abas", para: ["separador", "separadores"], generoNovo: "m" },
];

const DETERMINANTES = [...new Set(FEM_MASC.flat())].sort((a, b) => b.length - a.length).join("|");

function trocarGenero(texto: string, t: TrocaDeGenero): string {
  // Até DUAS palavras antes do nome concordam: "o seu time" → "a sua equipa",
  // "na própria tela" → "no próprio ecrã".
  const re = new RegExp(
    `((?:(?<![${L}])(?:${DETERMINANTES})\\s+){0,2})` +
      `(?<![${L}])(${t.plural}|${t.singular})(?![${L}])(?:(\\s+)(\\p{L}+))?`,
    "giu",
  );
  const mapa = t.generoNovo === "m" ? PARA_MASC : PARA_FEM;
  return texto.replace(
    re,
    (achado, antes: string, nome: string, esp: string | undefined, depois: string | undefined) => {
      if (t.exigeDeterminante && antes === "") return achado;
      const plural = nome.toLowerCase() === t.plural;
      const novoNome = comCaixaDe(nome, plural ? t.para[1] : t.para[0]);
      const antesFlexionado = antes.replace(/\p{L}+/gu, (w) => flexionar(w, mapa));
      return antesFlexionado + novoNome + (depois ? esp! + concordarAdjetivo(depois, t.generoNovo) : "");
    },
  );
}

// ─── 5. Artigo antes do possessivo ────────────────────────────────────────

const POSSESSIVOS: Record<string, string> = {
  seu: "o", sua: "a", seus: "os", suas: "as", meu: "o", minha: "a", meus: "os", minhas: "as",
  nosso: "o", nossa: "a", nossos: "os", nossas: "as",
};
/** Depois destes, o possessivo já tem artigo (ou não leva, em Moçambique também). */
const JA_DETERMINADO = new Set([
  "o", "a", "os", "as", "do", "da", "dos", "das", "no", "na", "nos", "nas", "ao", "à", "aos", "às",
  "pelo", "pela", "pelos", "pelas", "num", "numa", "dum", "duma", "um", "uma", "este", "esta", "esse",
  "essa", "aquele", "aquela", "deste", "desta", "neste", "nesta", "desse", "dessa", "nesse", "nessa",
  "é", "são", "era", "eram", "foi", "foram", "seja", "sejam", "for", "forem", "fosse", "ser", "sou", "somos",
  "cada", "qualquer",
]);
/** Preposição que contrai com o artigo. */
const CONTRACAO: Record<string, Record<string, string>> = {
  de: { o: "do", a: "da", os: "dos", as: "das" },
  em: { o: "no", a: "na", os: "nos", as: "nas" },
  por: { o: "pelo", a: "pela", os: "pelos", as: "pelas" },
};
/** Expressões fixas que dispensam o artigo também em Moçambique. */
const IDIOMAS_DO_POSSESSIVO = /^(em seu nome|em sua honra|por sua conta|por sua vez|por seu lado|de sua autoria)$/i;

const POSSESSIVO = new RegExp(
  `(?:(?<![${L}])(\\p{L}+)(\\s+)|(^|[.!?:;,(«"“·—]\\s*|\\n))(${Object.keys(POSSESSIVOS).join("|")})(?![${L}])`,
  "giu",
);

/**
 * O possessivo só leva artigo ANTES de um nome ("sua conta" → "a sua conta").
 * Depois do nome, ou sozinho, fica: "uma decisão sua", "É defeito nosso, não…",
 * "uma senha só sua", "Endpoint seu que…".
 */
const NAO_E_NOME = new Set([
  "que", "e", "ou", "de", "do", "da", "dos", "das", "em", "no", "na", "a", "o", "as", "os", "ao", "à",
  "para", "por", "pelo", "pela", "com", "sem", "se", "não", "é", "são", "mas", "como", "quando", "também",
  "já", "só", "ainda", "aqui", "ali", "lá",
]);

function artigoNoPossessivo(texto: string): string {
  return texto.replace(
    POSSESSIVO,
    (achado, antes: string | undefined, esp: string | undefined, inicio: string | undefined, pos: string, offset: number, todo: string) => {
      const artigo = POSSESSIVOS[pos.toLowerCase()]!;
      const comArtigo = (art: string) =>
        pos[0] === pos[0]!.toUpperCase() ? `${art[0]!.toUpperCase()}${art.slice(1)} ${pos.toLowerCase()}` : `${art} ${pos}`;
      // Com hífen: "seu e-mail" — sem ele, o "e" de "e-mail" passaria por conjunção.
      const seguinte = /^\s+(\p{L}+(?:-\p{L}+)*)/u.exec(todo.slice(offset + achado.length))?.[1];
      if (seguinte === undefined || NAO_E_NOME.has(seguinte.toLowerCase())) return achado;
      if (antes === undefined) return `${inicio ?? ""}${comArtigo(artigo)}`;
      // "Google Meu Negócio": possessivo em maiúscula no meio da frase é nome próprio.
      if (pos[0] !== pos[0]!.toLowerCase()) return achado;
      const prev = antes.toLowerCase();
      if (JA_DETERMINADO.has(prev)) return achado;
      if (IDIOMAS_DO_POSSESSIVO.test(`${prev} ${pos.toLowerCase()} ${seguinte.toLowerCase()}`)) return achado;
      const contraido = CONTRACAO[prev]?.[artigo];
      if (contraido) return `${comCaixaDe(antes, contraido)}${esp}${pos}`;
      return `${antes}${esp}${artigo} ${pos}`;
    },
  );
}

// ─── 6. "acessar X" → "aceder a X" ────────────────────────────────────────

const ACEDER: Record<string, string> = {
  acessar: "aceder", acesse: "aceda", acessa: "acede", acessou: "acedeu", acessam: "acedem",
  acessaram: "acederam", acessado: "acedido", acessada: "acedida", acessem: "acedam",
};
const ACESSAR = new RegExp(`(?<![${L}])(${Object.keys(ACEDER).join("|")})(?![${L}])(?:(\\s+)(\\p{L}+))?`, "giu");
const PREPOSICAO_A: Record<string, string> = { o: "ao", a: "à", os: "aos", as: "às" };

function acederA(texto: string): string {
  return texto.replace(ACESSAR, (_achado, verbo: string, esp: string | undefined, seguinte: string | undefined) => {
    const v = comCaixaDe(verbo, ACEDER[verbo.toLowerCase()]!);
    if (seguinte === undefined) return v;
    const s = seguinte.toLowerCase();
    if (PREPOSICAO_A[s]) return `${v}${esp}${PREPOSICAO_A[s]}`;
    // particípio ("acessado por"), preposição já presente, ou fim de oração: sem "a".
    if (/^(a|ao|à|aos|às|por|pelo|pela|de|em|com|se|e|ou|quando|que)$/.test(s) || /^(acedido|acedida)$/.test(v.toLowerCase())) {
      return `${v}${esp}${seguinte}`;
    }
    return `${v}${esp}a ${seguinte}`;
  });
}

// ─── 8. O pronome reflexivo depois do verbo ───────────────────────────────

/**
 * "Esta página se atualiza" → "Esta página atualiza-se": em Moçambique o
 * pronome vai depois do verbo, salvo quando uma palavra o atrai para antes
 * (não, que, já, quando…). Só com verbos REFLEXIVOS de uma lista fechada: o
 * "se" brasileiro é quase sempre a conjunção ("Confira se a chave…"), e essa
 * fica onde está.
 */
const REFLEXIVOS_FINITOS =
  "atualiza|atualizam|comporta|comportam|irrita|irritam|fecha|fecham|encaixa|encaixam|mexe|mexem|" +
  "perde|perdem|comunica|comunicam|destina|destinam|cala|calam|liga|ligam|muda|mudam|mede|medem|" +
  "apaga|apagam|repete|repetem|abre|abrem|chama|chamam|resolve|resolvem|acumula|acumulam|torna|tornam|" +
  "separa|separam|renova|renovam|desliga|desligam|sincroniza|sincronizam|tornará|tornarão|resolverá";
const REFLEXIVOS_INFINITIVOS = "acumular|resolver|chamar|apresentar|tornar|atualizar|perder|separar|repetir|comportar|mexer|fechar";
/** Atraem o pronome para antes do verbo — ou são verbos de "verificar se…". */
const ATRAEM_O_PRONOME = new Set(
  ("não nunca jamais nem que quem quando onde como porque se já também só ainda sempre bem mal talvez " +
    "ninguém nada tudo algo alguém isso isto aquilo todos todas qual quanto enquanto embora caso mesmo " +
    "até após sem para por de em a o e ou mas confira confere conferir conferiu verificar verifique saber " +
    "decidir decide veja ver ver pergunta perguntado confirmar confirma confirme avaliar descobrir dizendo " +
    "registar avisando entra assume aparece funciona usado imediatamente apenas inclusive normal").split(" "),
);
const ORACAO_QUE_ATRAI = new RegExp(
  `(?<![${L}])(não|nunca|jamais|nem|que|quem|quando|onde|como|qual|quais|porque|se|já|também|só|ainda|sempre|enquanto|embora|caso|talvez|ninguém|nada|tudo)(?![${L}])`,
  "iu",
);
const PRONOME_ANTES_DO_FINITO = new RegExp(
  `(?<![${L}])(\\p{L}+)(\\s+)se\\s+(${REFLEXIVOS_FINITOS})(?![${L}])`,
  "gu",
);
const PRONOME_ANTES_DO_INFINITIVO = new RegExp(
  `(?<![${L}])(vão|vai|costuma|costumam|pode|podem|deve|devem|consegue|conseguem|tende|tendem|Costuma|Costumam|Pode|Podem)(\\s+)se\\s+(${REFLEXIVOS_INFINITIVOS})(?![${L}])`,
  "gu",
);

function pronomeDepoisDoVerbo(texto: string): string {
  let s = texto.replace(PRONOME_ANTES_DO_FINITO, (achado, antes: string, esp: string, verbo: string, offset: number, todo: string) => {
    if (ATRAEM_O_PRONOME.has(antes.toLowerCase())) return achado;
    // A palavra que atrai pode estar antes do sujeito: "Como a IA se comporta",
    // "quando um cliente se irrita", "é onde ele se perde". Olha a oração inteira.
    const oracao = todo.slice(0, offset).split(/[.,;:!?—(]/).pop() ?? "";
    if (ORACAO_QUE_ATRAI.test(oracao)) return achado;
    // Futuro: "se tornará" → "tornar-se-á" (mesóclise).
    const futuro = /^(\p{L}+[aei]r)(á|ão)$/u.exec(verbo);
    return `${antes}${esp}${futuro ? `${futuro[1]}-se-${futuro[2]}` : `${verbo}-se`}`;
  });
  s = s.replace(PRONOME_ANTES_DO_INFINITIVO, (_achado, aux: string, esp: string, inf: string) => `${aux}${esp}${inf}-se`);
  // "precisa se apresentar" → "precisa de se apresentar" (depois de "de", o pronome fica antes).
  s = s.replace(new RegExp(`(?<![${L}])(precis\\p{L}*)(\\s+)se\\s+(\\p{L}+(?:ar|er|ir))(?![${L}])`, "gu"), "$1$2de se $3");
  return s;
}

// ─── 9. Ajustes que nenhuma regra geral alcança ───────────────────────────

/** Concordância à distância depois da troca de gênero, e casos únicos. Literal, aplicado no fim. */
const AJUSTES_FINAIS: ReadonlyArray<readonly [string, string]> = [
  ["ecrãs ficam vazias", "ecrãs ficam vazios"],
  ["ecrã ficar parada", "ecrã ficar parado"],
  ["ecrã atualiza-se sozinha", "ecrã atualiza-se sozinho"],
  ["ecrã de entrada é sempre a do sistema", "ecrã de entrada é sempre o do sistema"],
  ["ecrã estava aberta", "ecrã estava aberto"],
  ["aplicação autenticador", "aplicação autenticadora"],
  ["A ouvir você", "A ouvir…"],
  ["Configurar a conversar", "Configurar em conversa"],
  ["Nada a pedir decisão no momento.", "Nada à espera de decisão neste momento."],
  ["Me avisar ao passar de", "Avisar-me ao passar de"],
  // "arquivo" vira "ficheiro", mas tirar do ARQUIVO é desarquivar um funil.
  ["Tirar do ficheiro", "Tirar do arquivo"],
  ["tirar do ficheiro", "tirar do arquivo"],
  ["externa conectado", "externa conectada"],
  ["base de dados já tinha sido atualizado", "base de dados já tinha sido atualizada"],
  ["base de dados de origem não é tocado", "base de dados de origem não é tocada"],
  // "pegar" onde "apanhar" não soa natural.
  ["esperando o servidor apanhar", "à espera de que o servidor o receba"],
  ["Apanha uma resposta pronta", "Usa uma resposta pronta"],
  ["outra pessoa poder apanhar", "outra pessoa o poder marcar"],
  ["Qual agente apanha qual conversa", "Que agente fica com que conversa"],
  ["deve apanhar aquela conversa", "deve ficar com aquela conversa"],
  ["ninguém mais o apanha", "mais ninguém o ocupa"],
];

// ─── A camada ─────────────────────────────────────────────────────────────

/** A sigla da lei brasileira não é a base legal aqui: vira o nome do tema. */
const LGPD = /(?<![\p{L}\p{N}_])LGPD(?![\p{L}\p{N}_])/gu;

const cache = new Map<string, string>();
const TETO_DO_CACHE = 20_000;

export function paraPortuguesDeMocambique(texto: string): string {
  const memo = cache.get(texto);
  if (memo !== undefined) return memo;

  let saida = texto.replace(LGPD, "Proteção de Dados");
  for (const [re, para] of FRASES_FIXAS) saida = saida.replace(re, (achado) => comCaixaDe(achado, para));
  saida = trocarGerundios(saida);
  for (const t of TROCAS_DE_GENERO) saida = trocarGenero(saida, t);
  saida = trocarPalavras(saida);
  saida = artigoNoPossessivo(saida);
  saida = acederA(saida);
  saida = precisarDe(saida);
  saida = pronomeDepoisDoVerbo(saida);
  for (const [de, para] of AJUSTES_FINAIS) saida = saida.split(de).join(para);

  if (cache.size >= TETO_DO_CACHE) cache.clear();
  cache.set(texto, saida);
  return saida;
}

/**
 * A mesma camada sobre um HTML (e-mail), SÓ nos nós de texto: atributo, URL,
 * estilo e as chaves `{{ .X }}` do GoTrue ficam intactos. O que está dentro de
 * `<style>`/`<script>` também não é tocado.
 */
export function htmlEmPortuguesDeMocambique(html: string): string {
  return html.replace(/(<(style|script)\b[\s\S]*?<\/\2>)|>([^<]+)</gi, (achado, bloco: string | undefined, _tag, texto: string | undefined) =>
    bloco !== undefined || texto === undefined ? achado : `>${paraPortuguesDeMocambique(texto)}<`,
  );
}
