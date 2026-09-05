import { describe, expect, it, vi, beforeEach } from "vitest";

const { rateLimitMock, maybeSingleMock, envRef } = vi.hoisted(() => ({
  rateLimitMock: vi.fn(),
  maybeSingleMock: vi.fn(),
  envRef: { LICENSING_SIGNING_PRIVATE_KEY: "" },
}));

vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: rateLimitMock }));
vi.mock("@/lib/env", () => ({ env: envRef }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: maybeSingleMock,
        }),
      }),
    }),
  }),
}));

import { generateKeyPairSync } from "node:crypto";
const { privateKey } = generateKeyPairSync("ed25519");
envRef.LICENSING_SIGNING_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

import { POST } from "./route";

function req(body: unknown) {
  return new Request("http://localhost/api/v1/licensing/verify", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/licensing/verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitMock.mockResolvedValue({ allowed: true });
  });

  it("recusa license_key ausente", async () => {
    const res = await POST(req({}) as never);
    expect(res.status).toBe(422);
  });

  it("devolve 429 quando rate limited", async () => {
    rateLimitMock.mockResolvedValue({ allowed: false });
    const res = await POST(req({ license_key: "abc1234567" }) as never);
    expect(res.status).toBe(429);
  });

  it("devolve 404 para chave desconhecida", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    const res = await POST(req({ license_key: "abc1234567" }) as never);
    expect(res.status).toBe(404);
  });

  it("devolve status 'past_due' quando current_period_end já passou", async () => {
    maybeSingleMock.mockResolvedValue({
      data: {
        id: "lic-1",
        status: "active",
        current_period_end: "2020-01-01T00:00:00.000Z",
        trial_ends_at: null,
      },
      error: null,
    });
    const res = await POST(req({ license_key: "abc1234567" }) as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string; token: string } };
    expect(body.data.status).toBe("past_due");
    expect(body.data.token).toContain(".");
  });

  it("devolve status 'trial' quando dentro do período", async () => {
    maybeSingleMock.mockResolvedValue({
      data: {
        id: "lic-1",
        status: "trial",
        current_period_end: "2099-01-01T00:00:00.000Z",
        trial_ends_at: "2099-01-01T00:00:00.000Z",
      },
      error: null,
    });
    const res = await POST(req({ license_key: "abc1234567" }) as never);
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe("trial");
  });
});
