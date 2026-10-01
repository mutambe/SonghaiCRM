/**
 * A camada de português de Moçambique (lib/i18n/pt-mz.ts).
 *
 * Cada regra tem casos aqui, e os controles negativos guardam o que a camada
 * NÃO pode tocar — trocar errado é pior do que deixar a variante brasileira,
 * que o leitor moçambicano entende. Os casos negativos vieram da revisão das
 * 8 751 frases do produto: cada um é um estrago que uma versão da regra fez.
 */
import { describe, expect, it } from "vitest";

import { paraPortuguesDeMocambique as mz } from "@/lib/i18n/pt-mz";

describe("vocabulário de Moçambique", () => {
  it.each([
    ["Novo contato", "Novo contacto"],
    ["Contatos", "Contactos"],
    ["Importar contatos de planilha", "Importar contactos de folha de cálculo"],
    ["Cadastro concluído", "Registo concluído"],
    ["Registro de auditoria", "Registo de auditoria"],
    ["O agente registra a oportunidade", "O agente regista a oportunidade"],
    ["Envie um arquivo .csv", "Envie um ficheiro .csv"],
    ["Telefone celular", "Telefone telemóvel"],
    ["Salvar alterações", "Guardar alterações"],
    ["Alterações salvas", "Alterações guardadas"],
    ["Usuários da equipe", "Utilizadores da equipa"],
    ["Baixar PDF", "Transferir PDF"],
    ["Escaneie o QR code", "Digitalize o QR code"],
    ["Digite o código", "Introduza o código"],
    ["Pedido LGPD recebido", "Pedido Proteção de Dados recebido"],
    ["MANTER CONTATO", "MANTER CONTACTO"],
    ["CPF (opcional)", "NUIT (opcional)"],
    ["CNPJ", "NUIT"],
    ["Recuperar senha", "Recuperar palavra-passe"],
    ["Excluir contacto", "Eliminar contacto"],
    ["Título da seção", "Título da secção"],
    ["Nenhum fato durável", "Nenhum facto durável"],
    ["Gerenciar extensões", "Gerir extensões"],
    ["Buscar contactos…", "Procurar contactos…"],
    ["Fechar busca", "Fechar pesquisa"],
    ["Mídia indisponível", "Multimédia indisponível"],
    ["Adicionar parcela", "Adicionar prestação"],
    ["Negócio esfriou", "Negócio arrefeceu"],
    ["Contate o administrador.", "Contacte o administrador."],
    ["Onde pegar a chave", "Onde obter a chave"],
    ["a regra não pegou", "a regra não apanhou"],
    ["Cidade/UF", "Cidade/Província"],
  ])("%s → %s", (de, para) => {
    expect(mz(de)).toBe(para);
  });
});

describe("gerúndio", () => {
  it.each([
    ["Salvando…", "A guardar…"],
    ["Enviando...", "A enviar..."],
    ["Aguardando aprovação", "A aguardar aprovação"],
    ["Conectado! Avançando…", "Conectado! A avançar…"],
    ["Observando — o Jev conta as mensagens", "A observar — o Jev conta as mensagens"],
    ["carregando…", "a carregar…"],
  ])("que abre o texto ou a frase: %s → %s", (de, para) => {
    expect(mz(de)).toBe(para);
  });

  it.each([
    ["O e-mail está saindo por este servidor.", "O e-mail está a sair por este servidor."],
    ["A IA continua atendendo o cliente", "A IA continua a atender o cliente"],
    ["está sendo testada", "está a ser testada"],
    ["A mesma mensagem estava se repetindo", "A mesma mensagem estava a repetir-se"],
  ])("progressivo: %s → %s", (de, para) => {
    expect(mz(de)).toBe(para);
  });

  it.each([
    ["Conversa aguardando responsável", "Conversa a aguardar responsável"],
    ["1 caso esperando você", "1 caso à sua espera"],
    ["e preparando a próxima pergunta…", "e a preparar a próxima pergunta…"],
    ["um modelo de IA rodando na própria máquina", "um modelo de IA a correr na própria máquina"],
  ])("de estado depois de um nome: %s → %s", (de, para) => {
    expect(mz(de)).toBe(para);
  });

  it.each([
    // De MODO: português europeu correto.
    "Responda usando o modelo",
    "mova o cartão movendo-o no quadro",
    "Agradeça referindo o segmento",
    // Oração que termina em vírgula é de condição: "Arquivando, ele para…".
    "Arquivando, ele para de mover o cartão.",
    "Chegando mensagem nova, o relógio zera.",
    // "vai crescendo" é português europeu; "Sendo assim" é de modo.
    "vai crescendo por cerca de um mês",
    "Sendo assim, nada muda.",
    // Não são gerúndio.
    "Quando o cliente responder",
    "Segundo plano",
    "Fundo da conversa",
    "Comando da conversa",
  ])("não toca: %s", (texto) => {
    expect(mz(texto)).toBe(texto);
  });
});

describe("nome que muda de gênero", () => {
  it.each([
    ["Acompanhe o resultado nesta tela.", "Acompanhe o resultado neste ecrã."],
    ["Com a tela aberta", "Com o ecrã aberto"],
    ["no próprio ecrã", "no próprio ecrã"],
    ["na própria tela da campanha", "no próprio ecrã da campanha"],
    ["Buscar telas", "Procurar ecrãs"],
    ["Ícone do aplicativo", "Ícone da aplicação"],
    ["Use um aplicativo autenticador", "Use uma aplicação autenticadora"],
    ["Usada no aplicativo instalado", "Usada na aplicação instalada"],
    ["O banco de dados recusou a gravação", "A base de dados recusou a gravação"],
    ["Banco de dados externo", "Base de dados externa"],
    ["a consulta falhou (rede ou banco)", "a consulta falhou (rede ou base de dados)"],
    ["só o time vê", "só a equipa vê"],
    ["o nome que aparece para o seu time", "o nome que aparece para a sua equipa"],
    ["Time humano", "Equipa humana"],
    ["Abrir Conexões em outra aba", "Abrir Conexões noutro separador"],
  ])("%s → %s", (de, para) => {
    expect(mz(de)).toBe(para);
  });

  it("'time' sem determinante pode ser inglês: fica", () => {
    expect(mz("real time")).toBe("real time");
  });
});

describe("artigo antes do possessivo", () => {
  it.each([
    ["Sua conta", "A sua conta"],
    ["Seus dados estão intactos.", "Os seus dados estão intactos."],
    ["Confira sua sessão e tente novamente.", "Confira a sua sessão e tente novamente."],
    ["Informe seu e-mail", "Informe o seu e-mail"],
    ["Criar meu primeiro funil", "Criar o meu primeiro funil"],
    ["Atrito, seu funil e a sua performance", "Atrito, o seu funil e a sua performance"],
    ["ajudaria minha empresa", "ajudaria a minha empresa"],
  ])("%s → %s", (de, para) => {
    expect(mz(de)).toBe(para);
  });

  it.each([
    // Depois do nome, ou sozinho: sem artigo.
    "precisa de uma decisão sua.",
    "É defeito nosso, não da sua configuração.",
    "uma palavra-passe só sua",
    "Endpoint seu que fala a API",
    // Predicativo e expressões fixas.
    "a escolha é sua",
    "registadas em seu nome",
    "por sua conta e risco",
    // Nome próprio.
    "Google Meu Negócio",
    // Já tem artigo.
    "a sua conta",
    "da sua empresa",
  ])("não toca: %s", (texto) => {
    expect(mz(texto)).toBe(texto);
  });

  it("contrai com a preposição: 'de seu' → 'do seu'", () => {
    expect(mz("o nome de seu negócio")).toBe("o nome do seu negócio");
  });
});

describe("construções", () => {
  it.each([
    ["Não consegui acessar o microfone.", "Não consegui aceder ao microfone."],
    ["tentar acessar dados de outra organização", "tentar aceder a dados de outra organização"],
    ["A nova senha precisa ser diferente", "A nova palavra-passe precisa de ser diferente"],
    ["Você não precisa mexer em nada", "Você não precisa de mexer em nada"],
    ["um contacto novo precisa se apresentar", "um contacto novo precisa de se apresentar"],
    ["Escolha um atendimento em um canal disponível.", "Escolha um atendimento num canal disponível."],
    ["Conectei em outro lugar", "Conectei noutro lugar"],
    ["Esta página se atualiza sozinha", "Esta página atualiza-se sozinha"],
    ["Esta versão se tornará a ativa", "Esta versão tornar-se-á a ativa"],
    ["Costuma se resolver sozinho", "Costuma resolver-se sozinho"],
    ["Peça um novo a quem te convidou", "Peça um novo a quem lhe enviou o convite"],
  ])("%s → %s", (de, para) => {
    expect(mz(de)).toBe(para);
  });

  it.each([
    // "é preciso" é a expressão impessoal.
    "Para mudar de modelo é preciso reindexar tudo",
    // "precisa" + nome não é verbo no infinitivo.
    "Precisa melhor resultado",
    // A palavra que atrai o pronome pode estar antes do sujeito.
    "Como a IA se comporta",
    "quando um cliente se irrita",
    "é onde ele se perde",
    "o que você me contou",
    // "se" conjunção fica onde está.
    "Confira se a chave está certa",
  ])("não toca: %s", (texto) => {
    expect(mz(texto)).toBe(texto);
  });
});

describe("estabilidade", () => {
  it.each([
    "contatoX e xcontato não são palavras",
    "Isso não pode ser desfeito",
    "Você tem 3 conversas",
  ])("não toca: %s", (texto) => {
    expect(mz(texto)).toBe(texto);
  });

  it.each([
    "Salvando contatos…",
    "Sua conta foi confirmada, mas houve um erro ao preparar seu ambiente.",
    "Acompanhe o resultado nesta tela, sua equipa vê o mesmo.",
    "A IA continua atendendo enquanto o banco de dados se atualiza.",
  ])("aplicar duas vezes dá o mesmo texto: %s", (texto) => {
    const uma = mz(texto);
    expect(mz(uma)).toBe(uma);
  });
});
