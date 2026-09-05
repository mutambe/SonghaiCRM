import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

const {
  credentialsMaybeSingleMock,
  updatePaymentMock,
  singleLicenseMock,
  updateLicenseMock,
  decryptMock,
} = vi.hoisted(() => ({
  credentialsMaybeSingleMock: vi.fn(),
  updatePaymentMock: vi.fn(),
  singleLicenseMock: vi.fn(),
  updateLicenseMock: vi.fn(),
  decryptMock: vi.fn(),
}));

vi.mock("@/lib/webhooks/secrets", () => ({ decryptWebhookSecret: decryptMock }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "licensing_paysuite_credentials") {
        return { select: () => ({ eq: () => ({ maybeSingle: credentialsMaybeSingleMock }) }) };
      }
      if (table === "licensing_payments") {
        return {
          update: () => ({
            eq: () => ({
              eq: () => ({
                select: () => ({ maybeSingle: updatePaymentMock }),
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({ eq: () => ({ single: singleLicenseMock }) }),
        update: () => ({ eq: updateLicenseMock }),
      };
    },
  }),
}));

import { POST } from "./route";

function assinar(body: string) {
  return createHmac("sha256", "segredo-webhook").update(body).digest("hex");
}

function req(bodyObj: unknown, signature?: string) {
  const body = JSON.stringify(bodyObj);
  return new Request("http://localhost/api/v1/licensing/webhooks/paysuite", {
    method: "POST",
    body,
    headers: { "x-signature": signature ?? assinar(body) },
  });
}

describe("POST /api/v1/licensing/webhooks/paysuite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    credentialsMaybeSingleMock.mockResolvedValue({ data: { webhook_secret_encrypted: "\\xaaaa" } });
    decryptMock.mockResolvedValue("segredo-webhook");
  });

  it("rejeita assinatura inválida", async () => {
    const res = await POST(req({ event: "payment.success", data: { id: "p1" } }, "assinatura-errada") as never);
    expect(res.status).toBe(401);
  });

  it("rejeita quando a credencial não está configurada (fail-closed)", async () => {
    credentialsMaybeSingleMock.mockResolvedValue({ data: null });
    const res = await POST(req({ event: "payment.success", data: { id: "p1" } }) as never);
    expect(res.status).toBe(401);
  });

  it("ignora evento desconhecido com 200", async () => {
    const res = await POST(req({ event: "payout.success", data: { id: "p1" } }) as never);
    expect(res.status).toBe(200);
  });

  it("ignora quando não há pagamento pendente correspondente (idempotência)", async () => {
    updatePaymentMock.mockResolvedValue({ data: null, error: null });
    const res = await POST(req({ event: "payment.success", data: { id: "p1" } }) as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { reason?: string } };
    expect(body.data.reason).toBe("pagamento_nao_encontrado");
  });

  it("em payment.success: marca pago e estende current_period_end", async () => {
    updatePaymentMock.mockResolvedValue({
      data: { id: "pay-1", license_id: "lic-1", amount_cents: 500000 },
      error: null,
    });
    singleLicenseMock.mockResolvedValue({
      data: { id: "lic-1", current_period_end: "2026-09-04T00:00:00.000Z", plan_interval_days: 30 },
      error: null,
    });
    updateLicenseMock.mockResolvedValue({ error: null });

    const res = await POST(req({ event: "payment.success", data: { id: "p1" } }) as never);
    expect(res.status).toBe(200);
    expect(updateLicenseMock).toHaveBeenCalled();
  });
});
