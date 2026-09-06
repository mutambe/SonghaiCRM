/**
 * POST /api/v1/conversations/[id]/mark-read — o agente abriu (ou respondeu)
 * a conversa, então as mensagens do CLIENTE (inbound) viram "lidas" no CRM.
 *
 * Isto é distinto do ack do WAHA: aqui quem lê é o agente, não o WhatsApp do
 * cliente. Por isso o UPDATE:
 *  - só toca `direction = 'inbound'` (nunca mexe no rastro de leitura que o
 *    WAHA grava pra mensagens que NÓS enviamos);
 *  - filtra `organization_id` explicitamente (mesmo com RLS ligado no client
 *    de sessão, a rota não deve depender só disso pra provar isolamento);
 *  - é idempotente (`read_at is null`) — reabrir uma conversa já lida não
 *    deve reescrever nem re-auditar linha nenhuma.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import type { AuthUser } from "@/lib/auth/types";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const CONV_ID = "44444444-4444-4444-8444-444444444444";

interface Call {
  eqs: [string, unknown][];
  isCalls: [string, unknown][];
  payload: unknown;
}

function makeSupabaseStub(marked: Array<{ id: string }>) {
  const call: Call = { eqs: [], isCalls: [], payload: null };
  const chain = {
    update: (payload: unknown) => {
      call.payload = payload;
      return chain;
    },
    eq: (col: string, val: unknown) => {
      call.eqs.push([col, val]);
      return chain;
    },
    is: (col: string, val: unknown) => {
      call.isCalls.push([col, val]);
      return chain;
    },
    select: () => Promise.resolve({ data: marked, error: null }),
  };
  return { supabase: { from: () => chain }, call };
}

function agentSession(supabase: unknown) {
  const user: AuthUser = {
    id: AGENT_ID,
    email: "agent@example.com",
    full_name: null,
    avatar_url: null,
    is_platform_admin: false,
    organizations: [{ organization_id: ORG_ID, organization_name: "Org", role: "agent" }],
  };
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user,
    org: { orgId: ORG_ID, name: "Org", role: "agent" },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(createClient).mockResolvedValue(supabase as any);
}

function postReq() {
  return new NextRequest(`http://localhost/api/v1/conversations/${CONV_ID}/mark-read`, {
    method: "POST",
  });
}
const params = { params: Promise.resolve({ id: CONV_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /mark-read", () => {
  it("marca só inbound, da conversa e org certas, com read_at is null (idempotente)", async () => {
    const { supabase, call } = makeSupabaseStub([{ id: "m1" }, { id: "m2" }]);
    agentSession(supabase);
    const { POST } = await import("@/app/api/v1/conversations/[id]/mark-read/route");
    const res = await POST(postReq(), params);
    expect(res.status).toBe(200);
    expect(call.eqs).toEqual(
      expect.arrayContaining([
        ["conversation_id", CONV_ID],
        ["organization_id", ORG_ID],
        ["direction", "inbound"],
      ]),
    );
    expect(call.isCalls).toEqual(expect.arrayContaining([["read_at", null]]));
    expect(call.payload).toMatchObject({ read_at: expect.any(String) });
  });

  it("audita a mutação", async () => {
    const { supabase } = makeSupabaseStub([{ id: "m1" }]);
    agentSession(supabase);
    const { POST } = await import("@/app/api/v1/conversations/[id]/mark-read/route");
    await POST(postReq(), params);
    expect(
      vi.mocked(audit).mock.calls.some(([e]) => e.action === "conversation.messages_marked_read"),
    ).toBe(true);
  });

  it("nada pra marcar → 200 sem audit (evita ruído a cada abertura de conversa já lida)", async () => {
    const { supabase } = makeSupabaseStub([]);
    agentSession(supabase);
    const { POST } = await import("@/app/api/v1/conversations/[id]/mark-read/route");
    const res = await POST(postReq(), params);
    expect(res.status).toBe(200);
    expect(vi.mocked(audit)).not.toHaveBeenCalled();
  });
});
