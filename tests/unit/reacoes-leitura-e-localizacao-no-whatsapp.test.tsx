/**
 * SonghaiCRM — três recursos do WhatsApp trazidos da análise do OpenWA
 * (2026-10-02): os tiques azuis no aparelho do cliente, a reação com emoji (nos
 * dois sentidos) e o pino de localização de saída.
 *
 * Cada bloco prende uma ponta da corrente. A que mais falha em silêncio é a do
 * transporte: o código trata o evento e o WAHA nunca o envia — por isso há um
 * caso que lê os composes, como o de `mensagem-editada-e-apagada.test.ts`.
 */
import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextRequest } from "next/server";

import type * as Canais from "@/lib/channels";
import type * as ClienteWaha from "@/lib/waha/client";
import type * as Resolve from "@/lib/waha/resolve-contact-whatsapp-id";
import type { Message } from "@/lib/types/messaging";

const h = vi.hoisted(() => ({
  cliente: null as null | Record<string, ReturnType<typeof vi.fn>>,
  role: vi.fn(),
  suporte: vi.fn(),
  supabase: null as unknown,
  adapter: null as unknown,
  audit: vi.fn(),
}));

vi.mock("@/lib/waha/client", async (original) => ({
  ...(await original<typeof ClienteWaha>()),
  getWahaClient: () => h.cliente,
}));
vi.mock("@/lib/waha/resolve-contact-whatsapp-id", async (original) => ({
  ...(await original<typeof Resolve>()),
  resolveCanonicalCusChatId: async (_c: unknown, _s: string, to: string) => to,
}));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: h.suporte }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: h.role }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.supabase }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/channels", async (original) => ({
  ...(await original<typeof Canais>()),
  getAdapter: () => h.adapter,
}));

const { WahaClient } = await vi.importActual<typeof ClienteWaha>("@/lib/waha/client");
const canaisDeVerdade = await vi.importActual<typeof Canais>("@/lib/channels");

import { wahaAdapter } from "@/lib/channels/adapters/waha";
import { CANAIS_QUE_REAGEM, canalReageAMensagens } from "@/lib/channels/reacao-do-canal";
import { MessageBubble } from "@/components/inbox/MessageBubble";
import { avisarLeituraAoCanal } from "@/lib/inbox/leitura-no-canal";
import {
  CHAVE_DA_EQUIPA,
  aplicarReacao,
  emojiDeReacaoSchema,
  lerReacoes,
  reacaoDaEquipa,
} from "@/lib/messaging/reacoes";
import { coordenadasDoTexto, normalizarLocalizacaoDeSaida } from "@/lib/messaging/localizacao-de-saida";
import { sendMessageSchema } from "@/lib/schemas";
import { gravarReacaoRecebida } from "@/lib/waha/reacao-recebida";
import { POST as reagir } from "@/app/api/v1/messages/[id]/reaction/route";

const ORG = "org-1";
const MSG = "22222222-2222-4222-8222-222222222222";
const CONV = "11111111-1111-4111-8111-111111111111";
const AGORA = new Date("2026-10-02T10:00:00.000Z");

/**
 * Supabase de mentira: cada tabela devolve a linha dada; `update` é anotado e
 * devolve a linha atualizada. Chega para rotas que leem por id e gravam uma vez.
 */
function supabaseFalso(linhas: Record<string, unknown>) {
  const updates: Array<[string, Record<string, unknown>]> = [];
  const cliente = {
    updates,
    from(tabela: string) {
      let atualizado: Record<string, unknown> | null = null;
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "not", "order", "limit", "is"]) b[m] = () => b;
      b.update = (v: Record<string, unknown>) => {
        updates.push([tabela, v]);
        atualizado = v;
        return b;
      };
      b.maybeSingle = async () => ({
        data: atualizado ? { id: MSG, ...atualizado } : (linhas[tabela] ?? null),
        error: null,
      });
      // `await builder` sem maybeSingle (o update do ingest).
      b.then = (ok: (v: unknown) => unknown) => ok({ data: null, error: null });
      return b;
    },
  };
  return cliente;
}

afterEach(() => {
  vi.unstubAllGlobals();
  h.cliente = null;
});

// ─── O formato de metadata.reacoes ──────────────────────────────────────────

describe("reações: o formato central", () => {
  it("uma por pessoa: reagir de novo troca, '' tira, e o resto do metadata fica", () => {
    let m = aplicarReacao({ crm_hidden_at: null }, "258840000000@c.us", "👍", AGORA);
    m = aplicarReacao(m, CHAVE_DA_EQUIPA, "❤️", AGORA, "33333333-3333-4333-8333-333333333333");
    m = aplicarReacao(m, "258840000000@c.us", "😂", AGORA);
    expect(lerReacoes(m).map((r) => [r.emoji, r.daEquipa])).toEqual(
      expect.arrayContaining([["😂", false], ["❤️", true]]),
    );
    expect(lerReacoes(m)).toHaveLength(2);
    expect(reacaoDaEquipa(m)).toBe("❤️");
    m = aplicarReacao(m, CHAVE_DA_EQUIPA, "", AGORA);
    m = aplicarReacao(m, "258840000000@c.us", "", AGORA);
    expect(m).toEqual({ crm_hidden_at: null });
  });

  it("entrada torta é ignorada, não lança — a bolha não cai por um enfeite", () => {
    expect(lerReacoes({ reacoes: "x" })).toEqual([]);
    expect(lerReacoes({ reacoes: { a: { emoji: "" }, b: 3, c: { emoji: "👍", em: "2026-10-02" } } }))
      .toEqual([{ chave: "c", daEquipa: false, emoji: "👍", em: "2026-10-02" }]);
  });

  it("emoji: aceita sequência com tom e ZWJ e o vazio; recusa texto", () => {
    for (const ok of ["👍", "👍🏾", "👨‍👩‍👧", "❤️", ""]) expect(emojiDeReacaoSchema.safeParse(ok).success, ok).toBe(true);
    for (const nao of ["ok", "👍 👍", "1", "👍a"]) expect(emojiDeReacaoSchema.safeParse(nao).success, nao).toBe(false);
  });
});

// ─── O cliente WAHA fala os endpoints certos ────────────────────────────────

describe("cliente WAHA: leitura, reação e localização", () => {
  function capturarFetch(resposta: unknown = {}) {
    const chamadas: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init: RequestInit) => {
      chamadas.push({ url: String(url), init });
      return new Response(JSON.stringify(resposta), { status: 200 });
    }));
    return chamadas;
  }

  it("sendSeen: POST /api/sendSeen com a sessão e os ids no corpo", async () => {
    const chamadas = capturarFetch();
    await new WahaClient("http://waha", "k").sendSeen("s1", "258840000000@c.us", ["false_258840000000@c.us_AAA"]);
    expect(chamadas[0]!.url).toBe("http://waha/api/sendSeen");
    expect(chamadas[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(chamadas[0]!.init.body))).toEqual({
      session: "s1", chatId: "258840000000@c.us", messageIds: ["false_258840000000@c.us_AAA"],
    });
  });

  it("setReaction: PUT /api/reaction; '' é tirar", async () => {
    const chamadas = capturarFetch();
    await new WahaClient("http://waha", "k").setReaction("s1", "true_x@c.us_B", "");
    expect(chamadas[0]!.url).toBe("http://waha/api/reaction");
    expect(chamadas[0]!.init.method).toBe("PUT");
    expect(JSON.parse(String(chamadas[0]!.init.body))).toEqual({ session: "s1", messageId: "true_x@c.us_B", reaction: "" });
  });

  it("sendLocation: as coordenadas como número e o título só quando há", async () => {
    const chamadas = capturarFetch({ id: "3EB0" });
    await new WahaClient("http://waha", "k").sendLocation("s1", "c@c.us", { latitude: -25.96, longitude: 32.57 });
    expect(chamadas[0]!.url).toBe("http://waha/api/sendLocation");
    expect(JSON.parse(String(chamadas[0]!.init.body))).toEqual({
      session: "s1", chatId: "c@c.us", latitude: -25.96, longitude: 32.57,
    });
  });

  it("erro do WAHA sobe como waha_<status>, como nos vizinhos", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 422 })));
    await expect(new WahaClient("http://waha", "k").setReaction("s1", "m", "👍")).rejects.toThrow("waha_422");
  });
});

// ─── O adaptador monta os ids e escolhe o pino ──────────────────────────────

describe("adaptador WAHA", () => {
  function clienteFalso() {
    h.cliente = {
      sendSeen: vi.fn(async () => undefined),
      setReaction: vi.fn(async () => undefined),
      sendLocation: vi.fn(async () => ({ id: { id: "3EB0LOC" } })),
      sendMessage: vi.fn(async () => ({ id: "3EB0TXT" })),
    };
    return h.cliente;
  }

  it("markRead: o chat sai do id completo (preserva o @lid); recebida bare ganha false_", async () => {
    const c = clienteFalso();
    await wahaAdapter.markRead!({
      organizationId: ORG, sessionRef: "s1", recipient: "258840000000@c.us",
      externalIds: ["false_99887766@lid_AAA"],
    });
    expect(c.sendSeen).toHaveBeenCalledWith("s1", "99887766@lid", ["false_99887766@lid_AAA"]);
    await wahaAdapter.markRead!({ organizationId: ORG, sessionRef: "s1", recipient: "258840000000@c.us", externalIds: ["BBB"] });
    expect(c.sendSeen).toHaveBeenLastCalledWith("s1", "258840000000@c.us", ["false_258840000000@c.us_BBB"]);
  });

  it("markRead sem transporte configurado é NOOP — a leitura no CRM já aconteceu", async () => {
    h.cliente = null;
    await expect(wahaAdapter.markRead!({ organizationId: ORG, sessionRef: "s1", recipient: "x", externalIds: ["A"] }))
      .resolves.toBeUndefined();
  });

  it("reactToMessage: a nossa mensagem (bare) ganha true_; a do cliente passa intacta", async () => {
    const c = clienteFalso();
    await wahaAdapter.reactToMessage!({ organizationId: ORG, sessionRef: "s1", recipient: "258840000000@c.us", externalId: "3EB0", emoji: "👍" });
    expect(c.setReaction).toHaveBeenCalledWith("s1", "true_258840000000@c.us_3EB0", "👍");
    await wahaAdapter.reactToMessage!({ organizationId: ORG, sessionRef: "s1", recipient: null, externalId: "false_1@c.us_X", emoji: "" });
    expect(c.setReaction).toHaveBeenLastCalledWith("s1", "false_1@c.us_X", "");
  });

  it("send kind=location com coordenadas: sai o PINO, não o texto", async () => {
    const c = clienteFalso();
    const r = await wahaAdapter.send({
      organizationId: ORG, sessionRef: "s1", to: "258840000000@c.us", kind: "location",
      body: "📍 Loja — https://maps.google.com/?q=-25.96,32.57",
      location: { latitude: -25.96, longitude: 32.57, nome: "Loja", endereco: "Av. Julius Nyerere" },
    });
    expect(c.sendLocation).toHaveBeenCalledWith("s1", "258840000000@c.us", { latitude: -25.96, longitude: 32.57, title: "Loja" });
    expect(c.sendMessage).not.toHaveBeenCalled();
    expect(r.externalId).toBe("3EB0LOC");
  });
});

// ─── A tela pergunta a mesma coisa que o servidor ───────────────────────────

describe("que canal reage", () => {
  it("a lista da tela e a presença de reactToMessage no adapter concordam, canal a canal", () => {
    for (const p of canaisDeVerdade.PROVIDERS_DE_MENSAGEM) {
      const temMetodo = typeof canaisDeVerdade.getAdapter(p).reactToMessage === "function";
      expect(canalReageAMensagens(p), `${p}: tela e adapter divergem`).toBe(temMetodo);
    }
    expect(CANAIS_QUE_REAGEM.length).toBeGreaterThan(0);
    expect(canalReageAMensagens("wacalls")).toBe(false);
    expect(canalReageAMensagens(null)).toBe(false);
  });
});

// ─── A reação que chega pelo webhook ────────────────────────────────────────

describe("message.reaction recebido", () => {
  it("o transporte ASSINA o evento — sem isto nada chega", () => {
    for (const arquivo of ["docker-compose.prod.yml", "docker-compose.yml", "docker-compose.swarm.yml", "docker-compose.local.yml"]) {
      const linha = readFileSync(arquivo, "utf8").split("\n").find((l) => l.includes("WHATSAPP_HOOK_EVENTS")) ?? "";
      expect(linha, `${arquivo} não assina message.reaction`).toContain("message.reaction");
    }
    expect(readFileSync("lib/waha/ingest.ts", "utf8")).toMatch(/eventType === "message\.reaction"[\s\S]{0,200}gravarReacaoRecebida/);
  });

  it("cliente reage: grava na mensagem reagida, pela chave de quem reagiu", async () => {
    const admin = supabaseFalso({ messages: { id: MSG, metadata: { foo: 1 } } });
    const r = await gravarReacaoRecebida(admin as never, { organization_id: ORG }, {
      id: "evt", from: "258840000000@c.us", fromMe: false,
      reaction: { text: "👍", messageId: "true_258840000000@c.us_3EB0" },
    }, AGORA);
    expect(r).toBe("gravada");
    const [, v] = admin.updates[0]!;
    expect(lerReacoes(v.metadata as Record<string, unknown>)).toEqual([
      { chave: "258840000000@c.us", daEquipa: false, emoji: "👍", em: AGORA.toISOString() },
    ]);
    expect((v.metadata as Record<string, unknown>).foo).toBe(1);
  });

  it("o dono reage pelo aparelho (fromMe): é a reação da equipa; texto vazio tira", async () => {
    const admin = supabaseFalso({
      messages: { id: MSG, metadata: { reacoes: { [CHAVE_DA_EQUIPA]: { emoji: "❤️", em: "2026-10-01T00:00:00Z" } } } },
    });
    await gravarReacaoRecebida(admin as never, { organization_id: ORG }, {
      fromMe: true, from: "x@c.us", reaction: { text: "", messageId: "false_1@c.us_A" },
    }, AGORA);
    expect(admin.updates[0]![1].metadata).toEqual({});
  });

  it("mensagem desconhecida e payload torto não gravam nada", async () => {
    const vazio = supabaseFalso({});
    expect(await gravarReacaoRecebida(vazio as never, { organization_id: ORG }, {
      from: "a@c.us", reaction: { text: "👍", messageId: "M" },
    })).toBe("mensagem_desconhecida");
    expect(await gravarReacaoRecebida(vazio as never, { organization_id: ORG }, { from: "a@c.us" }))
      .toBe("payload_invalido");
    expect(vazio.updates).toEqual([]);
  });
});

// ─── A rota da reação ───────────────────────────────────────────────────────

describe("POST /api/v1/messages/[id]/reaction", () => {
  const ctx = { params: Promise.resolve({ id: MSG }) };
  const pedido = (corpo: unknown) =>
    new NextRequest(`http://localhost/api/v1/messages/${MSG}/reaction`, { method: "POST", body: JSON.stringify(corpo) });
  const linhas = (mensagem: Record<string, unknown> = {}) => ({
    messages: { id: MSG, organization_id: ORG, conversation_id: CONV, channel_session_id: "s1", external_id: "false_1@c.us_A", revoked_at: null, metadata: {}, ...mensagem },
    conversations: { id: CONV, contact_id: "ct1", is_group: false, group_chat_id: null, channel_session_id: "s1" },
    channel_sessions: { provider: "waha", waha_session_name: "sessao", archived_at: null },
    contacts: { phone_number: "+258840000001", wa_identity: null, wa_lid: null },
  });
  let reactToMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    h.suporte.mockResolvedValue(null);
    h.role.mockResolvedValue({ ok: true, org: { orgId: ORG }, user: { id: "33333333-3333-4333-8333-333333333333", idioma: "pt-MZ" } });
    reactToMessage = vi.fn(async () => undefined);
    h.adapter = {
      reactToMessage,
      isConfigured: () => true,
      resolveRecipient: () => "258840000001@c.us",
    };
  });

  it("sai pelo canal PRIMEIRO, depois grava a reação da equipa e audita", async () => {
    const sb = supabaseFalso(linhas());
    h.supabase = sb;
    const res = await reagir(pedido({ emoji: "👍" }), ctx);
    expect(res.status).toBe(200);
    expect(reactToMessage).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORG, sessionRef: "sessao", externalId: "false_1@c.us_A", emoji: "👍",
    }));
    expect(reacaoDaEquipa(sb.updates[0]![1].metadata as Record<string, unknown>)).toBe("👍");
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "message.reacted", resourceId: MSG }));
  });

  it("o canal recusou: 502 e NADA gravado — a tela não mostra o que o cliente não viu", async () => {
    const sb = supabaseFalso(linhas());
    h.supabase = sb;
    reactToMessage.mockRejectedValue(new Error("waha_500"));
    expect((await reagir(pedido({ emoji: "👍" }), ctx)).status).toBe(502);
    expect(sb.updates).toEqual([]);
  });

  it("mensagem sem id no canal, ou apagada: 403 sem chamar o canal", async () => {
    h.supabase = supabaseFalso(linhas({ external_id: null }));
    expect((await reagir(pedido({ emoji: "👍" }), ctx)).status).toBe(403);
    h.supabase = supabaseFalso(linhas({ revoked_at: "2026-10-01T00:00:00Z" }));
    expect((await reagir(pedido({ emoji: "👍" }), ctx)).status).toBe(403);
    expect(reactToMessage).not.toHaveBeenCalled();
  });

  it("canal que não reage: 409; texto no lugar de emoji: 422", async () => {
    h.supabase = supabaseFalso(linhas());
    h.adapter = { isConfigured: () => true, resolveRecipient: () => "x" };
    expect((await reagir(pedido({ emoji: "👍" }), ctx)).status).toBe(409);
    expect((await reagir(pedido({ emoji: "obrigado" }), ctx)).status).toBe(422);
  });

  it("suporte só-leitura é barrado antes do efeito", async () => {
    h.suporte.mockResolvedValue(new Response(null, { status: 403 }));
    h.supabase = supabaseFalso(linhas());
    expect((await reagir(pedido({ emoji: "👍" }), ctx)).status).toBe(403);
    expect(reactToMessage).not.toHaveBeenCalled();
  });
});

// ─── Os tiques azuis no aparelho ────────────────────────────────────────────

describe("avisar a leitura ao canal", () => {
  let markRead: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    markRead = vi.fn(async () => undefined);
    h.adapter = { markRead, isConfigured: () => true, resolveRecipient: () => "258840000001@c.us" };
  });

  it("manda a ÚLTIMA recebida, pela sessão da conversa", async () => {
    const sb = supabaseFalso({
      conversations: { id: CONV, contact_id: "ct1", is_group: false, channel_session_id: "s1" },
      channel_sessions: { provider: "waha", waha_session_name: "sessao", archived_at: null },
      contacts: { phone_number: "+258840000001", wa_identity: null, wa_lid: null },
      messages: { external_id: "false_258840000001@c.us_ULTIMA" },
    });
    expect(await avisarLeituraAoCanal(sb as never, ORG, CONV)).toBe("avisado");
    expect(markRead).toHaveBeenCalledWith({
      organizationId: ORG, sessionRef: "sessao", recipient: "258840000001@c.us",
      externalIds: ["false_258840000001@c.us_ULTIMA"],
    });
  });

  it("grupo não recebe tique azul — diria a todos os participantes que a empresa leu", async () => {
    const sb = supabaseFalso({ conversations: { id: CONV, contact_id: "ct1", is_group: true, channel_session_id: "s1" } });
    expect(await avisarLeituraAoCanal(sb as never, ORG, CONV)).toBe("grupo");
    expect(markRead).not.toHaveBeenCalled();
  });

  it("a rota mark-read só avisa quando o CRM acabou de marcar alguma recebida", () => {
    const fonte = readFileSync("app/api/v1/conversations/[id]/mark-read/route.ts", "utf8");
    expect(fonte).toMatch(/if \(marcadas > 0\)\s*\{\s*await avisarLeituraAoCanal/);
  });
});

// ─── A localização de saída ─────────────────────────────────────────────────

describe("localização de saída", () => {
  it("lê coordenadas soltas e links do Google Maps; link encurtado não traz", () => {
    expect(coordenadasDoTexto("-25.9692, 32.5732")).toEqual({ latitude: -25.9692, longitude: 32.5732 });
    expect(coordenadasDoTexto("-25.9692 32.5732")).toEqual({ latitude: -25.9692, longitude: 32.5732 });
    expect(coordenadasDoTexto("https://www.google.com/maps/place/Maputo/@-25.9692,32.5732,15z"))
      .toEqual({ latitude: -25.9692, longitude: 32.5732 });
    expect(coordenadasDoTexto("https://maps.google.com/?q=-19.8436,34.8389")).toEqual({ latitude: -19.8436, longitude: 34.8389 });
    expect(coordenadasDoTexto("https://maps.app.goo.gl/abc123")).toBeNull();
    expect(coordenadasDoTexto("95, 10")).toBeNull();
  });

  it("o schema aceita o pino sem corpo, e recusa location sem coordenadas", () => {
    const base = { conversation_id: CONV, type: "location" as const };
    expect(sendMessageSchema.safeParse({ ...base, metadata: { location: { latitude: -25.96, longitude: 32.57 } } }).success).toBe(true);
    expect(sendMessageSchema.safeParse({ ...base, metadata: { location: { latitude: 0, longitude: 0 } } }).success).toBe(false);
  });

  it("normaliza: corpo com o link do mapa e metadata.location no formato da recebida", () => {
    const r = normalizarLocalizacaoDeSaida({
      conversation_id: CONV, type: "location",
      metadata: { location: { latitude: "-25.96", longitude: 32.57, name: "Loja" } },
    } as never);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.body).toBe("📍 Loja — https://maps.google.com/?q=-25.96,32.57");
    expect(r.input.metadata?.location).toEqual({ latitude: -25.96, longitude: 32.57, name: "Loja" });
    expect(normalizarLocalizacaoDeSaida({ conversation_id: CONV, type: "location" } as never).ok).toBe(false);
  });

  it("o handler põe o pino no envelope de texto", () => {
    const fonte = readFileSync("app/api/v1/messages/_handler.ts", "utf8");
    expect(fonte).toMatch(/normalizarLocalizacaoDeSaida\(input\)/);
    expect(fonte).toMatch(/localizacaoDeSaida \? \{ location: localizacaoDeSaida \} : \{\}/);
  });
});

// ─── A bolha ────────────────────────────────────────────────────────────────

function mensagem(over: Partial<Message> = {}): Message {
  return {
    id: MSG, organization_id: ORG, conversation_id: CONV, channel_session_id: "s1", contact_id: "ct1",
    external_id: "false_1@c.us_A", type: "text", direction: "inbound", status: "received", ack: null,
    error_code: null, error_message: null, body: "Pode ser às 15h?", media_url: null, media_mime: null,
    media_size_bytes: null, media_storage_path: null, sent_via: "crm", sent_by_user_id: null,
    sent_at: "2026-10-02T09:00:00.000Z", delivered_at: null, read_at: null, metadata: {},
    edited_at: null, revoked_at: null, reply_to_message_id: null, created_at: "2026-10-02T09:00:00.000Z",
    ...over,
  };
}

describe("bolha: reagir e ver as reações", () => {
  it("o menu oferece os emojis; o que a equipa já deu é para TIRAR", async () => {
    const user = userEvent.setup();
    const onReagir = vi.fn(async () => undefined);
    const { rerender } = render(<MessageBubble message={mensagem()} onReagir={onReagir} />);
    await user.click(screen.getByRole("button", { name: /Op[cç][oõ]es da mensagem/ }));
    await user.click(await screen.findByRole("menuitem", { name: /Reagir com 👍/ }));
    expect(onReagir).toHaveBeenCalledWith("👍");

    rerender(<MessageBubble message={mensagem({ metadata: aplicarReacao({}, CHAVE_DA_EQUIPA, "👍", AGORA) })} onReagir={onReagir} />);
    await user.click(screen.getByRole("button", { name: /Op[cç][oõ]es da mensagem/ }));
    await user.click(await screen.findByRole("menuitem", { name: /Tirar reação 👍/ }));
    expect(onReagir).toHaveBeenLastCalledWith("");
  });

  it("sem id no canal não há o que reagir: o menu não oferece emoji", async () => {
    const user = userEvent.setup();
    render(<MessageBubble message={mensagem({ external_id: null })} onReagir={vi.fn()} onResponder={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Op[cç][oõ]es da mensagem/ }));
    await screen.findAllByRole("menuitem");
    expect(screen.queryByRole("menuitem", { name: /Reagir com/ })).toBeNull();
  });

  it("as reações aparecem na pílula, agrupadas, dizendo quem", () => {
    let meta = aplicarReacao({}, "258840000001@c.us", "👍", AGORA);
    meta = aplicarReacao(meta, CHAVE_DA_EQUIPA, "👍", AGORA);
    render(<MessageBubble message={mensagem({ metadata: meta })} />);
    const pilula = screen.getByTestId("reacoes-da-mensagem");
    expect(pilula.textContent).toBe("👍2");
    expect(pilula.querySelector("span")?.getAttribute("title")).toMatch(/Cliente.*Equipa|Equipa.*Cliente/);
  });
});
