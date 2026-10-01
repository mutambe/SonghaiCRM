/**
 * SonghaiCRM — tiques de leitura na bolha do CLIENTE (porte do `bcb34686c`).
 *
 * Abrir a conversa (ou responder) chama o mark-read do upstream; além de zerar
 * o contador, ele passa a gravar `read_at` nas mensagens recebidas ainda não
 * lidas, e a bolha mostra dois tiques: "Recebida" (neutro) ou "Lida pela
 * equipa" (verde). O verde não é o azul do ack — esse é o cliente a ler o que
 * nós enviámos.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextRequest } from "next/server";

import { MessageBubble } from "@/components/inbox/MessageBubble";
import type { Message } from "@/lib/types/messaging";
import type * as Leitura from "@/lib/inbox/leitura-das-recebidas";

const h = vi.hoisted(() => ({
  handler: vi.fn(),
  marcar: vi.fn(),
  role: vi.fn(),
  suporte: vi.fn(),
}));

vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: h.suporte }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: h.role }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/app/api/v1/conversations/_handler", () => ({ markConversationReadHandler: h.handler }));
vi.mock("@/lib/inbox/leitura-das-recebidas", async (original) => ({
  ...(await original<typeof Leitura>()),
  marcarRecebidasComoLidas: h.marcar,
}));

const { marcarRecebidasComoLidas: marcarDeVerdade } =
  await vi.importActual<typeof Leitura>("@/lib/inbox/leitura-das-recebidas");

import { POST } from "@/app/api/v1/conversations/[id]/mark-read/route";

const ORG = "org-1";
const CONV = "11111111-1111-4111-8111-111111111111";
const ctx = { params: Promise.resolve({ id: CONV }) };
const pedido = () => new NextRequest(`http://localhost/api/v1/conversations/${CONV}/mark-read`, { method: "POST" });

beforeEach(() => {
  vi.clearAllMocks();
  h.suporte.mockResolvedValue(null);
  h.role.mockResolvedValue({ ok: true, org: { orgId: ORG }, user: { id: "u1", idioma: "pt-MZ" } });
  h.handler.mockResolvedValue({ id: CONV, unread_count_for_assignee: 0 });
});

describe("POST mark-read também marca as recebidas", () => {
  it("zera o contador E marca as mensagens do cliente, na organização do ator", async () => {
    h.marcar.mockResolvedValue(3);
    expect((await POST(pedido(), ctx)).status).toBe(200);
    expect(h.marcar).toHaveBeenCalledWith(expect.anything(), ORG, CONV);
  });

  it("falha ao marcar não derruba a resposta (o contador já foi zerado)", async () => {
    h.marcar.mockRejectedValue(new Error("boom"));
    expect((await POST(pedido(), ctx)).status).toBe(200);
  });

  it("viewer recusado antes de qualquer escrita", async () => {
    h.role.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await POST(pedido(), ctx)).status).toBe(403);
    expect(h.marcar).not.toHaveBeenCalled();
  });
});

describe("marcarRecebidasComoLidas", () => {
  it("só recebidas, só ainda não lidas, filtrando organização e conversa", async () => {
    const filtros: Array<[string, unknown[]]> = [];
    const b: Record<string, unknown> = {};
    for (const m of ["update", "eq", "is"]) {
      b[m] = (...args: unknown[]) => {
        filtros.push([m, args]);
        return b;
      };
    }
    b.select = async () => ({ data: [{ id: "a" }, { id: "b" }], error: null });
    const supabase = { from: (t: string) => (t === "messages" ? b : null) };

    const n = await marcarDeVerdade(supabase as never, ORG, CONV, new Date("2026-10-01T10:00:00Z"));
    expect(n).toBe(2);
    expect(filtros).toEqual([
      ["update", [{ read_at: "2026-10-01T10:00:00.000Z" }]],
      ["eq", ["organization_id", ORG]],
      ["eq", ["conversation_id", CONV]],
      ["eq", ["direction", "inbound"]],
      ["is", ["read_at", null]],
    ]);
  });
});

function recebida(readAt: string | null): Message {
  return {
    id: "m1", organization_id: ORG, conversation_id: CONV, channel_session_id: "s1", contact_id: "ct1",
    external_id: null, type: "text", direction: "inbound", status: "received", ack: null,
    error_code: null, error_message: null, body: "Olá", media_url: null, media_mime: null,
    media_size_bytes: null, media_storage_path: null, sent_via: "crm", sent_by_user_id: null,
    sent_at: "2026-10-01T09:00:00.000Z", delivered_at: null, read_at: readAt, metadata: {},
    edited_at: null, revoked_at: null, reply_to_message_id: null, created_at: "2026-10-01T09:00:00.000Z",
  };
}

describe("bolha do cliente", () => {
  it("sem leitura: dois tiques neutros, 'Recebida'", () => {
    render(<MessageBubble message={recebida(null)} />);
    expect(screen.getByLabelText("Recebida")).toBeTruthy();
    expect(screen.queryByLabelText("Lida pela equipa")).toBeNull();
  });

  it("lida no CRM: tiques verdes, 'Lida pela equipa' — não o azul do ack", () => {
    render(<MessageBubble message={recebida("2026-10-01T09:05:00.000Z")} />);
    const tique = screen.getByLabelText("Lida pela equipa");
    expect(tique.getAttribute("class")).toContain("text-success-fg");
    expect(tique.getAttribute("class")).not.toContain("blue");
  });
});

