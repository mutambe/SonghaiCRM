// lib/evolution/ingest.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("../channels/pos-entrada", () => ({
  aplicarEfeitosPosEntrada: vi.fn(),
}));

import { aplicarEfeitosPosEntrada } from "../channels/pos-entrada";

import { ingestEvolutionInbound } from "./ingest";

function buildAdminMock(overrides: {
  contactId?: string;
  conversationId?: string;
  insertResult?: { data: { id: string } | null; error: { code?: string; message?: string } | null };
}) {
  const insertResult = overrides.insertResult ?? { data: { id: "msg-1" }, error: null };
  const rpc = vi.fn((fn: string) => {
    if (fn === "fn_upsert_wa_contact") return Promise.resolve({ data: overrides.contactId ?? "contact-1", error: null });
    if (fn === "fn_upsert_wa_conversation") return Promise.resolve({ data: overrides.conversationId ?? "conv-1", error: null });
    if (fn === "fn_mark_conversation_message") return Promise.resolve({ data: null, error: null });
    if (fn === "emit_event") return Promise.resolve({ data: null, error: null });
    throw new Error(`rpc inesperada: ${fn}`);
  });

  const insertChain = { select: () => ({ maybeSingle: () => Promise.resolve(insertResult) }) };
  const from = vi.fn((table: string) => {
    if (table === "messages") return { insert: () => insertChain };
    if (table === "contacts") return { update: () => ({ eq: () => ({ is: () => Promise.resolve({ error: null }) }) }) };
    throw new Error(`tabela inesperada: ${table}`);
  });

  return { rpc, from };
}

/** Cast só no ponto de chamada: preserva `rpc`/`from` como `vi.fn()` tipados para as asserções. */
function asAdmin(mock: ReturnType<typeof buildAdminMock>) {
  return mock as never;
}

const PAYLOAD_TEXTO = {
  event: "messages.upsert",
  instance: "org_abc",
  data: {
    key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: false, id: "3EB0XYZ" },
    pushName: "Fulano",
    message: { conversation: "oi" },
    messageTimestamp: 1734000000,
  },
};

describe("ingestEvolutionInbound", () => {
  it("mensagem de texto nova: cria contato, conversa e mensagem", async () => {
    vi.mocked(aplicarEfeitosPosEntrada).mockClear();
    const admin = buildAdminMock({});
    const r = await ingestEvolutionInbound(asAdmin(admin), {
      organizationId: "org-1",
      channelSessionId: "sess-1",
      payload: PAYLOAD_TEXTO,
    });
    expect(r).toMatchObject({ status: "ingested", conversationId: "conv-1", messageId: "msg-1" });
    // Inbound dispara os efeitos pós-entrada (opt-out, lead, agente).
    expect(aplicarEfeitosPosEntrada).toHaveBeenCalledTimes(1);
  });

  it("reentrega (23505): retorna duplicate, sem lançar", async () => {
    const admin = buildAdminMock({
      insertResult: { data: null, error: { code: "23505" } },
    });
    const r = await ingestEvolutionInbound(asAdmin(admin), {
      organizationId: "org-1",
      channelSessionId: "sess-1",
      payload: PAYLOAD_TEXTO,
    });
    expect(r).toMatchObject({ status: "duplicate", conversationId: "conv-1" });
  });

  it("evento sem interesse: ignored, sem tocar o banco", async () => {
    const admin = buildAdminMock({});
    const r = await ingestEvolutionInbound(asAdmin(admin), {
      organizationId: "org-1",
      channelSessionId: "sess-1",
      payload: { event: "qrcode.updated", data: {} },
    });
    expect(r.status).toBe("ignored");
  });

  it("grupo (@g.us): ignored sem telefone reconhecível, sem tocar o banco", async () => {
    const admin = buildAdminMock({});
    const payloadGrupo = {
      event: "messages.upsert",
      instance: "org_abc",
      data: {
        key: { remoteJid: "120363000000000000@g.us", fromMe: false, id: "3EB0GRP" },
        pushName: "Fulano",
        message: { conversation: "oi grupo" },
        messageTimestamp: 1734000000,
      },
    };
    const r = await ingestEvolutionInbound(asAdmin(admin), {
      organizationId: "org-1",
      channelSessionId: "sess-1",
      payload: payloadGrupo,
    });
    expect(r).toMatchObject({ status: "ignored", reason: "chatId_sem_telefone_reconhecivel" });
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("eco de saída (fromMe=true): ingerido, mas NÃO dispara efeitos pós-entrada", async () => {
    vi.mocked(aplicarEfeitosPosEntrada).mockClear();
    const admin = buildAdminMock({});
    const payloadEco = {
      event: "messages.upsert",
      instance: "org_abc",
      data: {
        key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: true, id: "3EB0OUT" },
        message: { conversation: "resposta do atendente" },
        messageTimestamp: 1734000002,
      },
    };
    const r = await ingestEvolutionInbound(asAdmin(admin), {
      organizationId: "org-1",
      channelSessionId: "sess-1",
      payload: payloadEco,
    });
    expect(r).toMatchObject({ status: "ingested", conversationId: "conv-1", messageId: "msg-1" });
    expect(aplicarEfeitosPosEntrada).not.toHaveBeenCalled();
  });

  it("mensagem com anexo (imagem): pede persistência da mídia via emit_event", async () => {
    const admin = buildAdminMock({});
    const payloadImagem = {
      event: "messages.upsert",
      instance: "org_abc",
      data: {
        key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: false, id: "3EB0IMG" },
        pushName: "Fulano",
        message: { imageMessage: { caption: "foto", mimetype: "image/jpeg" } },
        messageType: "imageMessage",
        messageTimestamp: 1734000001,
      },
    };
    const r = await ingestEvolutionInbound(asAdmin(admin), {
      organizationId: "org-1",
      channelSessionId: "sess-1",
      payload: payloadImagem,
    });
    expect(r).toMatchObject({ status: "ingested", conversationId: "conv-1", messageId: "msg-1" });
    expect(admin.rpc).toHaveBeenCalledWith(
      "emit_event",
      expect.objectContaining({
        p_event_type: "media.persist_requested",
        p_entity_kind: "message",
        p_entity_id: "msg-1",
        p_payload: { message_id: "msg-1", conversation_id: "conv-1" },
        p_metadata: { source: "evolution_webhook" },
        p_organization_id: "org-1",
      }),
    );
  });
});
