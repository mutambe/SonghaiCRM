import { describe, expect, it, vi, beforeEach } from "vitest";

const { requireAuthMock, resolveActiveOrgMock, requestRenewalMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  resolveActiveOrgMock: vi.fn(),
  requestRenewalMock: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({
  requireAuth: requireAuthMock,
  resolveActiveOrg: resolveActiveOrgMock,
}));
vi.mock("@/lib/env", () => ({
  env: { LICENSE_KEY: "key-1", LICENSING_CENTRAL_URL: "https://central.example.com" },
}));
vi.mock("@/lib/licensing/central-client", () => ({ requestRenewal: requestRenewalMock }));

import { renovarLicenca } from "./renovar";

describe("renovarLicenca (server action)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("recusa quem não é admin da org ativa", async () => {
    requireAuthMock.mockResolvedValue({ id: "u1" });
    resolveActiveOrgMock.mockResolvedValue({ orgId: "org1", role: "agent" });
    const r = await renovarLicenca();
    expect("error" in r).toBe(true);
  });

  it("devolve checkoutUrl quando admin e tudo configurado", async () => {
    requireAuthMock.mockResolvedValue({ id: "u1" });
    resolveActiveOrgMock.mockResolvedValue({ orgId: "org1", role: "admin" });
    requestRenewalMock.mockResolvedValue({ checkoutUrl: "https://paysuite.tech/checkout/x" });
    const r = await renovarLicenca();
    expect(r).toEqual({ checkoutUrl: "https://paysuite.tech/checkout/x" });
  });
});
