import { describe, expect, it, vi, beforeEach } from "vitest";

const { fetchLicenseTokenMock, upsertMock } = vi.hoisted(() => ({
  fetchLicenseTokenMock: vi.fn(),
  upsertMock: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  env: {
    INTERNAL_CRON_SECRET: "cron-secret",
    INTERNAL_SECRET: "",
    LICENSE_KEY: "key-1",
    LICENSING_CENTRAL_URL: "https://central.example.com",
  },
}));
vi.mock("@/lib/licensing/central-client", () => ({ fetchLicenseToken: fetchLicenseTokenMock }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ upsert: upsertMock }) }),
}));

import { GET } from "./route";

function req(auth?: string) {
  return new Request("http://localhost/api/v1/cron/licensing-refresh", {
    headers: auth ? { authorization: auth } : {},
  });
}

describe("GET /api/v1/cron/licensing-refresh", () => {
  beforeEach(() => vi.clearAllMocks());

  it("recusa sem o segredo de cron", async () => {
    const res = await GET(req() as never);
    expect(res.status).toBe(403);
  });

  it("atualiza licensing_client_state com o token novo", async () => {
    fetchLicenseTokenMock.mockResolvedValue("token-assinado");
    upsertMock.mockResolvedValue({ error: null });

    const res = await GET(req("Bearer cron-secret") as never);
    expect(res.status).toBe(200);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "singleton", token: "token-assinado" }),
    );
  });

  it("não lança quando a central está inacessível — mantém o cache anterior", async () => {
    fetchLicenseTokenMock.mockRejectedValue(new Error("timeout"));
    const res = await GET(req("Bearer cron-secret") as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { refreshed: boolean } };
    expect(body.data.refreshed).toBe(false);
    expect(upsertMock).not.toHaveBeenCalled();
  });
});
