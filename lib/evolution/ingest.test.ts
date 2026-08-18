// lib/evolution/ingest.test.ts
import { describe, expect, it, vi } from "vitest";

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

  return { rpc, from } as never;
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
    const admin = buildAdminMock({});
    const r = await ingestEvolutionInbound(admin, {
      organizationId: "org-1",
      channelSessionId: "sess-1",
      payload: PAYLOAD_TEXTO,
    });
    expect(r).toMatchObject({ status: "ingested", conversationId: "conv-1", messageId: "msg-1" });
  });

  it("reentrega (23505): retorna duplicate, sem lançar", async () => {
    const admin = buildAdminMock({
      insertResult: { data: null, error: { code: "23505" } },
    });
    const r = await ingestEvolutionInbound(admin, {
      organizationId: "org-1",
      channelSessionId: "sess-1",
      payload: PAYLOAD_TEXTO,
    });
    expect(r).toMatchObject({ status: "duplicate", conversationId: "conv-1" });
  });

  it("evento sem interesse: ignored, sem tocar o banco", async () => {
    const admin = buildAdminMock({});
    const r = await ingestEvolutionInbound(admin, {
      organizationId: "org-1",
      channelSessionId: "sess-1",
      payload: { event: "qrcode.updated", data: {} },
    });
    expect(r.status).toBe("ignored");
  });
});
