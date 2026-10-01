/**
 * PORTUGUÊS DE MOÇAMBIQUE — a camada de vocabulário sobre o texto do produto.
 *
 * ─── Por que uma camada, e não um dicionário frase a frase ─────────────────
 *
 * O texto das telas nasce em português do Brasil no upstream (DeskcommCRM), e
 * passa TODO por `t()` — o upstream tem um guarda que reprova prosa fora dele.
 * Um dicionário frase a frase para Moçambique teria milhares de entradas quase
 * iguais à fonte, e envelheceria a cada tela nova do upstream. A diferença real
 * entre as duas variantes, no que um CRM mostra, é de VOCABULÁRIO e de uma
 * construção (o gerúndio de "Salvando…"), não de frase. Esta camada aplica
 * essa diferença a qualquer texto que passe por `t()`, inclusive os que o
 * upstream ainda vai escrever.
 *
 * ─── De onde veio a lista ──────────────────────────────────────────────────
 *
 * Das trocas que o próprio SonghaiCRM fez à mão quando converteu as telas
 * (commits c244ebe75, 9e058a6be e 498ab7567 do fork): "Salvando" → "A guardar",
 * "contato" → "contacto", "cadastro"/"registro" → "registo", "arquivo" →
 * "ficheiro", "celular" → "telemóvel", "LGPD" → "Proteção de Dados". Palavra
 * nova entra aqui com um caso no teste — e só se tiver o MESMO GÊNERO da
 * original: "aplicativo" → "aplicação" ficou de fora porque quebraria a
 * concordância ("um aplicação autenticador").
 *
 * ─── O que ela NÃO faz, de propósito ───────────────────────────────────────
 *
 * Não reescreve gramática ("você" é usado em Moçambique; "Isso" é correto) e
 * não troca palavra ambígua sem contexto ("tela" também é tecido; "time" é
 * palavra inglesa em nome de produto). Trocar errado é pior do que deixar a
 * variante brasileira, que o leitor moçambicano entende.
 */

/** [regex, substituição]. A regex casa a palavra INTEIRA (borda Unicode). */
type Troca = [RegExp, string];

/** Palavras com a mesma forma em todas as flexões que o produto usa. */
const PALAVRAS: ReadonlyArray<readonly [string, string]> = [
  ["contato", "contacto"],
  ["contatos", "contactos"],
  ["cadastro", "registo"],
  ["cadastros", "registos"],
  ["cadastrar", "registar"],
  ["cadastrado", "registado"],
  ["cadastrada", "registada"],
  ["cadastrados", "registados"],
  ["cadastradas", "registadas"],
  ["cadastre", "registe"],
  ["registro", "registo"],
  ["registros", "registos"],
  ["registrar", "registar"],
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
  // O documento do titular e o da empresa, em Moçambique, é o NUIT (mesmo gênero).
  ["cpf", "NUIT"],
  ["cnpj", "NUIT"],
  ["pra", "para"],
];

/** Mantém a caixa da primeira letra (e a caixa toda, se a fonte for maiúscula). */
function comCaixaDe(fonte: string, alvo: string): string {
  if (fonte.length > 1 && fonte === fonte.toUpperCase()) return alvo.toUpperCase();
  const primeira = fonte.charAt(0);
  return primeira === primeira.toUpperCase() && primeira !== primeira.toLowerCase()
    ? alvo.charAt(0).toUpperCase() + alvo.slice(1)
    : alvo;
}

const TROCAS: Troca[] = PALAVRAS.map(([de]) => [
  // `\p{L}` e não `\b`: `\b` do JS só conhece ASCII, e "usuário" quebraria no "á".
  new RegExp(`(?<![\\p{L}\\p{N}_])${de}(?![\\p{L}\\p{N}_])`, "giu"),
  de,
]);

/**
 * "Salvando…" → "A guardar…". Só o gerúndio que ABRE um texto de estado
 * (seguido de reticências) — é a única posição em que a troca é segura.
 * "Quando", "Fundo" e "Segundo" terminam em -ndo e não são gerúndio; o
 * casamento exige as reticências logo depois, que nenhum deles tem nos rótulos.
 */
const GERUNDIO_DE_ESTADO = /^(\p{Lu}\p{Ll}+?)(ando|endo|indo)(?=(?:\s[^\n]*)?(?:…|\.\.\.)$)/u;
const INFINITIVO: Record<string, string> = { ando: "ar", endo: "er", indo: "ir" };

/** A sigla da lei brasileira não é a base legal aqui: vira o nome do tema. */
const LGPD = /(?<![\p{L}\p{N}_])LGPD(?![\p{L}\p{N}_])/gu;

const cache = new Map<string, string>();
const TETO_DO_CACHE = 20_000;

export function paraPortuguesDeMocambique(texto: string): string {
  const memo = cache.get(texto);
  if (memo !== undefined) return memo;

  let saida = texto.replace(LGPD, "Proteção de Dados");
  const g = GERUNDIO_DE_ESTADO.exec(saida);
  if (g) {
    // Só o gerúndio é trocado; o resto do texto (e as reticências) fica.
    const [inteiro, raiz, sufixo] = g as unknown as [string, string, string];
    let verbo = raiz.toLowerCase() + INFINITIVO[sufixo];
    // "Salvando" → "A salvar" → "A guardar": o vocabulário vale também aqui.
    const troca = PALAVRAS.find(([de]) => de === verbo);
    if (troca) verbo = troca[1];
    saida = `A ${verbo}` + saida.slice(inteiro.length);
  }
  for (const [re, de] of TROCAS) {
    const para = PALAVRAS.find(([d]) => d === de)![1];
    saida = saida.replace(re, (achado) => comCaixaDe(achado, para));
  }

  if (cache.size >= TETO_DO_CACHE) cache.clear();
  cache.set(texto, saida);
  return saida;
}
