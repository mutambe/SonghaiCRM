import { describe, expect, it, vi, beforeEach } from "vitest";

const { requireRoleMock, maybeSingleMock, encryptMock, updateEqMock, insertMock, auditMock, suporteMock } = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  maybeSingleMock: vi.fn(),
  encryptMock: vi.fn(),
  updateEqMock: vi.fn(),
  insertMock: vi.fn(),
  auditMock: vi.fn(),
  suporteMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-role", () => ({ requireRole: requireRoleMock }));
vi.mock("@/lib/webhooks/secrets", () => ({ encryptWebhookSecret: encryptMock }));
vi.mock("@/lib/audit", () => ({ audit: auditMock }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: suporteMock }));
// A base pública é a MESMA de todo webhook do produto (lib/webhooks/url-publica.ts,
// testado lá): aqui só importa que a rota a use, com o caminho do PaySuite.
vi.mock("@/lib/webhooks/url-publica", () => ({ basePublicaDaInstalacao: () => "https://crm.songhai.co.mz" }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: maybeSingleMock }) }) }),
      update: () => ({ eq: () => ({ eq: updateEqMock }) }),
      insert: insertMock,
    }),
  }),
}));

import { GET, POST } from "./route";

const URL_DA_ROTA = "http://0.0.0.0:3000/api/v1/integrations/paysuite";

function req(body?: unknown) {
  return new Request(URL_DA_ROTA, body ? { method: "POST", body: JSON.stringify(body) } : {});
}

beforeEach(() => {
  vi.clearAllMocks();
  requireRoleMock.mockResolvedValue({ ok: true, user: { id: "user-1" }, org: { orgId: "org-1" } });
  suporteMock.mockResolvedValue(null);
});

describe("GET /api/v1/integrations/paysuite", () => {
  it("recusa quem não é admin", async () => {
    requireRoleMock.mockResolvedValue({ ok: false, response: new Response("nao", { status: 403 }) });
    expect((await GET(req() as never)).status).toBe(403);
  });

  it("devolve configured:false quando não há credencial guardada", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    const body = (await (await GET(req() as never)).json()) as { data: { configured: boolean } };
    expect(body.data.configured).toBe(false);
  });

  it("devolve a URL do webhook na base pública da instalação — nunca o token de API", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { status: "healthy", status_reason: null, webhook_path_token: "tok123", updated_at: "2026-10-01" },
      error: null,
    });
    const res = await GET(req() as never);
    const texto = await res.text();
    expect(JSON.parse(texto).data.webhook_url).toBe("https://crm.songhai.co.mz/api/v1/webhooks/payments/paysuite/tok123");
    expect(texto).not.toMatch(/api_token|webhook_secret/);
  });
});

describe("POST /api/v1/integrations/paysuite", () => {
  it("recusa payload inválido", async () => {
    expect((await POST(req({ api_token: "" }) as never)).status).toBe(422);
  });

  it("primeira configuração: cifra, grava, audita e devolve a URL do webhook", async () => {
    encryptMock.mockResolvedValue("\\xaaaa");
    maybeSingleMock
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { id: "cred-1", webhook_path_token: "novo-token" }, error: null });
    insertMock.mockResolvedValue({ error: null });

    const res = await POST(req({ api_token: "tok-1234567890", webhook_secret: "seg-1234567890" }) as never);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { webhook_url: string } };
    expect(body.data.webhook_url).toBe("https://crm.songhai.co.mz/api/v1/webhooks/payments/paysuite/novo-token");
    expect(encryptMock).toHaveBeenCalledTimes(2);
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "payment.credentials_saved", organizationId: "org-1", actorUserId: "user-1" }),
    );
  });

  it("suporte temporário não grava: a guarda de efeito barra antes de cifrar", async () => {
    suporteMock.mockResolvedValue(new Response("so observa", { status: 403 }));
    const res = await POST(req({ api_token: "tok-1234567890", webhook_secret: "seg-1234567890" }) as never);
    expect(res.status).toBe(403);
    expect(encryptMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });
});
