import { describe, expect, it, vi, beforeEach } from "vitest";

const { requireRoleMock, maybeSingleMock, encryptMock, upsertMock, insertMock } = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  maybeSingleMock: vi.fn(),
  encryptMock: vi.fn(),
  upsertMock: vi.fn(),
  insertMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-role", () => ({ requireRole: requireRoleMock }));
vi.mock("@/lib/webhooks/secrets", () => ({ encryptWebhookSecret: encryptMock }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: maybeSingleMock }) }) }),
      update: () => ({ eq: upsertMock }),
      insert: insertMock,
    }),
  }),
}));

import { GET, POST } from "./route";

function req(url: string, body?: unknown, headers?: Record<string, string>) {
  return new Request(url, {
    ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
    ...(headers ? { headers } : {}),
  });
}

describe("GET /api/v1/integrations/paysuite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue({ ok: true, org: { orgId: "org-1" } });
  });

  it("recusa quem não é admin", async () => {
    requireRoleMock.mockResolvedValue({ ok: false, response: new Response("nao", { status: 403 }) });
    const res = await GET(req("https://crm.songhai.ltd/api/v1/integrations/paysuite") as never);
    expect(res.status).toBe(403);
  });

  it("devolve configured:false quando não há credencial salva", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    const res = await GET(req("https://crm.songhai.ltd/api/v1/integrations/paysuite") as never);
    const body = (await res.json()) as { data: { configured: boolean } };
    expect(body.data.configured).toBe(false);
  });

  /**
   * Achado em produção (2026-09-05): `resolveBaseUrl` costumava confiar em
   * `process.env.NEXT_PUBLIC_APP_URL` — uma NEXT_PUBLIC_* fica gravada na
   * imagem Docker em BUILD time (no CI, que publica uma imagem só pra todo
   * self-hoster), nunca é lida do `.env` da VPS em runtime. Sem domínio real
   * no build, vira `https://build-placeholder.invalid` congelado no bundle
   * — a URL de webhook devolvida pra colar no PaySuite saía sempre errada,
   * pra QUALQUER self-hoster. A URL da própria requisição é a única fonte
   * confiável.
   */
  it("monta a webhook_url a partir do domínio da REQUISIÇÃO, nunca de env", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { status: "healthy", status_reason: null, webhook_path_token: "tok123", updated_at: "2026-09-05" },
      error: null,
    });
    const originalEnv = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://build-placeholder.invalid";
    try {
      const res = await GET(req("https://crm.songhai.ltd/api/v1/integrations/paysuite") as never);
      const body = (await res.json()) as { data: { webhook_url: string } };
      expect(body.data.webhook_url).toBe(
        "https://crm.songhai.ltd/api/v1/webhooks/payments/paysuite/tok123",
      );
      expect(body.data.webhook_url).not.toContain("placeholder.invalid");
    } finally {
      process.env.NEXT_PUBLIC_APP_URL = originalEnv;
    }
  });

  /**
   * Segundo achado (2026-09-06), depois de "resolver" o de cima: trocar pra
   * `new URL(req.url).origin` sozinho TAMBÉM saía errado em produção atrás
   * do Traefik — devolvia `http://0.0.0.0:3000` (o bind interno do
   * container). `req.url` reflete a conexão TCP que o Node recebeu, não o
   * `Host` que o navegador mandou pro proxy. Simula exatamente essa forma:
   * a URL da requisição aponta pro bind interno, mas o Traefik anexou
   * `X-Forwarded-Host`/`X-Forwarded-Proto` com o domínio público real.
   */
  it("prefere X-Forwarded-Host/Proto — req.url sozinho é o bind interno atrás do Traefik", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { status: "healthy", status_reason: null, webhook_path_token: "tok123", updated_at: "2026-09-05" },
      error: null,
    });
    const res = await GET(
      req("http://0.0.0.0:3000/api/v1/integrations/paysuite", undefined, {
        "x-forwarded-host": "crm.songhai.ltd",
        "x-forwarded-proto": "https",
      }) as never,
    );
    const body = (await res.json()) as { data: { webhook_url: string } };
    expect(body.data.webhook_url).toBe(
      "https://crm.songhai.ltd/api/v1/webhooks/payments/paysuite/tok123",
    );
  });
});

describe("POST /api/v1/integrations/paysuite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue({ ok: true, org: { orgId: "org-1" } });
  });

  it("recusa payload inválido", async () => {
    const res = await POST(req("https://crm.songhai.ltd/api/v1/integrations/paysuite", { api_token: "" }) as never);
    expect(res.status).toBe(422);
  });

  it("também monta a webhook_url do domínio da requisição no POST", async () => {
    encryptMock.mockResolvedValue("\\xaaaa");
    maybeSingleMock
      .mockResolvedValueOnce({ data: null, error: null }) // existing lookup (insert path)
      .mockResolvedValueOnce({ data: { webhook_path_token: "novo-token" }, error: null }); // saved lookup
    insertMock.mockResolvedValue({ error: null });

    const originalEnv = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://build-placeholder.invalid";
    try {
      const res = await POST(
        req("https://crm.songhai.ltd/api/v1/integrations/paysuite", {
          api_token: "tok-1234567890",
          webhook_secret: "seg-1234567890",
        }) as never,
      );
      const body = (await res.json()) as { data: { webhook_url: string } };
      expect(body.data.webhook_url).toContain("https://crm.songhai.ltd/");
      expect(body.data.webhook_url).not.toContain("placeholder.invalid");
    } finally {
      process.env.NEXT_PUBLIC_APP_URL = originalEnv;
    }
  });
});
