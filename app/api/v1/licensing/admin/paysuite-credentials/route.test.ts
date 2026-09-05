import { describe, expect, it, vi, beforeEach } from "vitest";

const { loadAuthUserMock, maybeSingleMock, encryptMock, upsertMock } = vi.hoisted(() => ({
  loadAuthUserMock: vi.fn(),
  maybeSingleMock: vi.fn(),
  encryptMock: vi.fn(),
  upsertMock: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({ loadAuthUser: loadAuthUserMock }));
vi.mock("@/lib/webhooks/secrets", () => ({ encryptWebhookSecret: encryptMock }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: maybeSingleMock }) }),
      upsert: upsertMock,
    }),
  }),
}));

import { GET, POST } from "./route";

function req(body: unknown) {
  return new Request("http://localhost/api/v1/licensing/admin/paysuite-credentials", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("/api/v1/licensing/admin/paysuite-credentials", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GET recusa quem não é platform admin", async () => {
    loadAuthUserMock.mockResolvedValue({ id: "u1", is_platform_admin: false });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("GET devolve configured:false quando não há credencial salva", async () => {
    loadAuthUserMock.mockResolvedValue({ id: "u1", is_platform_admin: true });
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    const res = await GET();
    const body = (await res.json()) as { data: { configured: boolean } };
    expect(body.data.configured).toBe(false);
  });

  it("GET devolve status sem nunca incluir o segredo", async () => {
    loadAuthUserMock.mockResolvedValue({ id: "u1", is_platform_admin: true });
    maybeSingleMock.mockResolvedValue({
      data: { status: "healthy", updated_at: "2026-09-05T00:00:00.000Z" },
      error: null,
    });
    const res = await GET();
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data.configured).toBe(true);
    expect(JSON.stringify(body)).not.toContain("token");
  });

  it("POST recusa quem não é platform admin", async () => {
    loadAuthUserMock.mockResolvedValue({ id: "u1", is_platform_admin: false });
    const res = await POST(req({ api_token: "tok-123456", webhook_secret: "seg-123456" }) as never);
    expect(res.status).toBe(403);
  });

  it("POST recusa payload inválido", async () => {
    loadAuthUserMock.mockResolvedValue({ id: "u1", is_platform_admin: true });
    const res = await POST(req({ api_token: "" }) as never);
    expect(res.status).toBe(422);
  });

  it("POST cifra e salva as duas credenciais", async () => {
    loadAuthUserMock.mockResolvedValue({ id: "u1", is_platform_admin: true });
    encryptMock.mockResolvedValueOnce("\\xaaaa").mockResolvedValueOnce("\\xbbbb");
    upsertMock.mockResolvedValue({ error: null });

    const res = await POST(req({ api_token: "tok-123456", webhook_secret: "seg-123456" }) as never);
    expect(res.status).toBe(201);
    expect(encryptMock).toHaveBeenCalledTimes(2);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "singleton",
        api_token_encrypted: "\\xaaaa",
        webhook_secret_encrypted: "\\xbbbb",
        status: "healthy",
      }),
    );
  });

  it("POST devolve 500 se a cifra estiver indisponível (GUC ausente)", async () => {
    loadAuthUserMock.mockResolvedValue({ id: "u1", is_platform_admin: true });
    encryptMock.mockResolvedValue(null);
    const res = await POST(req({ api_token: "tok-123456", webhook_secret: "seg-123456" }) as never);
    expect(res.status).toBe(500);
  });
});
