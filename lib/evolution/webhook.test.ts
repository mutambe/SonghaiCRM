import { describe, expect, it } from "vitest";

import { parseEvolutionConnectionUpdate, parseEvolutionInbound } from "./webhook";

const TEXTO = {
  event: "messages.upsert",
  instance: "org_abc123",
  data: {
    key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: false, id: "3EB0XYZ" },
    pushName: "Fulano",
    message: { conversation: "oi, tudo bem?" },
    messageType: "conversation",
    messageTimestamp: 1734000000,
  },
};

const IMAGEM = {
  event: "messages.upsert",
  instance: "org_abc123",
  data: {
    key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: false, id: "3EB0IMG" },
    pushName: "Fulano",
    message: { imageMessage: { caption: "olha isso", mimetype: "image/jpeg" } },
    messageType: "imageMessage",
    messageTimestamp: 1734000001,
  },
};

const ECO = {
  event: "messages.upsert",
  instance: "org_abc123",
  data: {
    key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: true, id: "3EB0OUT" },
    message: { conversation: "resposta do atendente" },
    messageType: "conversation",
    messageTimestamp: 1734000002,
  },
};

describe("parseEvolutionInbound", () => {
  it("mensagem de texto: direction inbound, body presente", () => {
    const msg = parseEvolutionInbound(TEXTO);
    expect(msg).toMatchObject({
      externalId: "3EB0XYZ",
      chatId: "5511999999999@s.whatsapp.net",
      direction: "inbound",
      body: "oi, tudo bem?",
      pushName: "Fulano",
      attachmentType: null,
    });
  });

  it("mensagem de imagem: attachmentType = image, body = caption", () => {
    const msg = parseEvolutionInbound(IMAGEM);
    expect(msg).toMatchObject({
      externalId: "3EB0IMG",
      attachmentType: "image",
      body: "olha isso",
    });
  });

  it("fromMe=true vira direction outbound (eco do próprio envio)", () => {
    const msg = parseEvolutionInbound(ECO);
    expect(msg?.direction).toBe("outbound");
  });

  it("evento de outro tipo: null", () => {
    expect(parseEvolutionInbound({ event: "qrcode.updated", data: {} })).toBeNull();
  });

  it("payload sem forma reconhecível: null, não lança", () => {
    expect(parseEvolutionInbound(null)).toBeNull();
    expect(parseEvolutionInbound("lixo")).toBeNull();
    expect(parseEvolutionInbound({})).toBeNull();
  });
});

describe("parseEvolutionConnectionUpdate", () => {
  it("extrai o state", () => {
    expect(
      parseEvolutionConnectionUpdate({
        event: "connection.update",
        instance: "org_abc123",
        data: { state: "open" },
      }),
    ).toEqual({ state: "open" });
  });

  it("null para outro evento", () => {
    expect(parseEvolutionConnectionUpdate({ event: "messages.upsert", data: {} })).toBeNull();
  });
});
