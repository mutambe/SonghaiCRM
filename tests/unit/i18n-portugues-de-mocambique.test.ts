/**
 * A camada de vocabulário moçambicano (lib/i18n/pt-mz.ts).
 *
 * Cada palavra da lista tem um caso aqui, e os controles negativos guardam o
 * que a camada NÃO pode tocar — trocar errado é pior do que deixar a variante
 * brasileira, que o leitor moçambicano entende.
 */
import { describe, expect, it } from "vitest";

import { paraPortuguesDeMocambique as mz } from "@/lib/i18n/pt-mz";

describe("vocabulário de Moçambique", () => {
  it.each([
    ["Novo contato", "Novo contacto"],
    ["Contatos", "Contactos"],
    ["Importar contatos de planilha", "Importar contactos de planilha"],
    ["Cadastro concluído", "Registo concluído"],
    ["Registro de auditoria", "Registo de auditoria"],
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
  ])("%s → %s", (de, para) => {
    expect(mz(de)).toBe(para);
  });

  it.each([
    ["Salvando…", "A guardar…"],
    ["Enviando...", "A enviar..."],
    ["Gerando relatório…", "A gerar relatório…"],
    ["Conferindo…", "A conferir…"],
    ["Escrevendo…", "A escrever…"],
  ])("gerúndio de estado: %s → %s", (de, para) => {
    expect(mz(de)).toBe(para);
  });

  it.each([
    "Quando o cliente responder",
    "Segundo plano",
    "Fundo da conversa",
    "Comando da conversa",
    "Isso não pode ser desfeito",
    "Você tem 3 conversas",
    "Tela inicial",
    "Use um aplicativo autenticador",
    "contatoX e xcontato não são palavras",
  ])("não toca: %s", (texto) => {
    expect(mz(texto)).toBe(texto);
  });

  it("é estável: aplicar duas vezes dá o mesmo texto", () => {
    const uma = mz("Salvando contatos…");
    expect(mz(uma)).toBe(uma);
  });
});
