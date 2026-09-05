import { describe, expect, it, vi, beforeEach } from "vitest";

const { licenseMaybeSingleMock, credentialsMaybeSingleMock, insertMock, createPaymentMock, decryptMock } =
  vi.hoisted(() => ({
    licenseMaybeSingleMock: vi.fn(),
    credentialsMaybeSingleMock: vi.fn(),
    insertMock: vi.fn(),
    createPaymentMock: vi.fn(),
    decryptMock: vi.fn(),
  }));

vi.mock("@/lib/env", () => ({
  env: {
    LICENSING_PUBLIC_BASE_URL: "https://central.example.com",
  },
}));
vi.mock("@/lib/payments/paysuite/client", () => ({ createPayment: createPaymentMock }));
vi.mock("@/lib/webhooks/secrets", () => ({ decryptWebhookSecret: decryptMock }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "licensing_licenses") {
        return { select: () => ({ eq: () => ({ maybeSingle: licenseMaybeSingleMock }) }) };
      }
      if (table === "licensing_paysuite_credentials") {
        return { select: () => ({ eq: () => ({ maybeSingle: credentialsMaybeSingleMock }) }) };
      }
      return { insert: insertMock };
    },
  }),
}));

import { POST } from "./route";

function req(body: unknown) {
  return new Request("http://localhost/api/v1/licensing/renew", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/licensing/renew", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    credentialsMaybeSingleMock.mockResolvedValue({ data: { api_token_encrypted: "\\xaaaa" } });
    decryptMock.mockResolvedValue("tok-central");
  });

  it("recusa license_key ausente", async () => {
    const res = await POST(req({}) as never);
    expect(res.status).toBe(422);
  });

  it("devolve 404 para chave desconhecida", async () => {
    licenseMaybeSingleMock.mockResolvedValue({ data: null });
    const res = await POST(req({ license_key: "abc1234567" }) as never);
    expect(res.status).toBe(404);
  });

  it("devolve 409 quando a credencial do PaySuite não está configurada", async () => {
    licenseMaybeSingleMock.mockResolvedValue({ data: { id: "lic-1", plan_amount_cents: 500000 } });
    credentialsMaybeSingleMock.mockResolvedValue({ data: null });
    const res = await POST(req({ license_key: "abc1234567" }) as never);
    expect(res.status).toBe(409);
  });

  it("cria pagamento no PaySuite e registra licensing_payments", async () => {
    licenseMaybeSingleMock.mockResolvedValue({ data: { id: "lic-1", plan_amount_cents: 500000 } });
    createPaymentMock.mockResolvedValue({ id: "psuite-1", checkoutUrl: "https://paysuite.tech/checkout/x" });
    insertMock.mockResolvedValue({ error: null });

    const res = await POST(req({ license_key: "abc1234567" }) as never);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { checkout_url: string } };
    expect(body.data.checkout_url).toBe("https://paysuite.tech/checkout/x");
    expect(createPaymentMock).toHaveBeenCalledWith(
      "tok-central",
      expect.objectContaining({ amount: "5000.00" }),
    );
  });

  it("devolve 502 quando o PaySuite falha", async () => {
    licenseMaybeSingleMock.mockResolvedValue({ data: { id: "lic-1", plan_amount_cents: 500000 } });
    createPaymentMock.mockRejectedValue(new Error("upstream down"));
    const res = await POST(req({ license_key: "abc1234567" }) as never);
    expect(res.status).toBe(502);
  });
});
