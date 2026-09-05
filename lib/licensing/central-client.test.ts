import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fetchLicenseToken, requestRenewal, LicensingCentralError } from "./central-client";

describe("licensing/central-client", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("fetchLicenseToken devolve o token em sucesso", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ data: { token: "abc.def" } }), { status: 200 }),
    );
    const token = await fetchLicenseToken("https://central.example.com", "key-1");
    expect(token).toBe("abc.def");
  });

  it("fetchLicenseToken lança LicensingCentralError em 404", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "chave desconhecida" } }), { status: 404 }),
    );
    await expect(fetchLicenseToken("https://central.example.com", "key-1")).rejects.toThrow(
      LicensingCentralError,
    );
  });

  it("requestRenewal devolve checkoutUrl em sucesso", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ data: { checkout_url: "https://paysuite.tech/checkout/x" } }), {
        status: 201,
      }),
    );
    const { checkoutUrl } = await requestRenewal("https://central.example.com", "key-1");
    expect(checkoutUrl).toBe("https://paysuite.tech/checkout/x");
  });

  it("requestRenewal lança LicensingCentralError quando o body não tem checkout_url", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ data: {} }), { status: 200 }),
    );
    await expect(requestRenewal("https://central.example.com", "key-1")).rejects.toThrow(
      LicensingCentralError,
    );
  });
});
