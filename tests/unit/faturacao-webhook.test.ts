/**
 * SonghaiCRM — o webhook do PaySuite reconhece pagamento de FACTURA de pacote.
 *
 * O mesmo endereço serve os dois mundos: o pagamento de um negócio de uma
 * organização (`payments`) e a mensalidade de um cliente (`billing_invoices`).
 * Este ficheiro prova a fronteira: só o webhook da organização que RECEBE pode
 * fechar factura, e quando o faz não toca no outro mundo.
 */
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { lerConfigDaFaturacao } from "@/lib/billing/config";
import { registrarPagamentoDeFatura } from "@/lib/billing/executar";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/webhooks/secrets", () => ({ decryptWebhookSecret: vi.fn() }));
vi.mock("@/lib/leads/activity-emitter", () => ({ emitLeadActivity: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/billing/config", () => ({ lerConfigDaFaturacao: vi.fn() }));
vi.mock("@/lib/billing/dependencias", () => ({ dependenciasReais: vi.fn(async () => ({ marca: "deps" })) }));
vi.mock("@/lib/billing/executar", async (original) => ({
  ...(await original<typeof import("@/lib/billing/executar")>()),
  registrarPagamentoDeFatura: vi.fn(async () => true),
}));

const ORG_QUE_RECEBE = "11111111-1111-4111-8111-111111111111";
const OUTRA_ORG = "22222222-2222-4222-8222-222222222222";
const TOKEN = "abcdef0123456789abcdef0123456789";
const SECRET = "segredo";
const FATURA = { id: "fat-1", organization_id: "cliente-1", provider_payment_id: "prov-1" };

const assinar = (corpo: string) => createHmac("sha256", SECRET).update(corpo).digest("hex");

function banco(opts: { dono: string; fatura: unknown }) {
  const tocouEmPayments = vi.fn();
  const cadeia = (resultado: () => unknown) => {
    const b: Record<string, unknown> = {};
    for (const m of ["eq", "neq", "select"]) b[m] = () => b;
    b.maybeSingle = async () => ({ data: resultado(), error: null });
    return b;
  };
  const db = {
    from(tabela: string) {
      if (tabela === "payment_credentials") {
        return { select: () => cadeia(() => ({ organization_id: opts.dono, webhook_secret_encrypted: "enc" })) };
      }
      if (tabela === "billing_invoices") return { select: () => cadeia(() => opts.fatura) };
      if (tabela === "payments") {
        tocouEmPayments();
        return { update: () => cadeia(() => null), select: () => cadeia(() => null) };
      }
      throw new Error(`tabela inesperada ${tabela}`);
    },
  };
  return { db, tocouEmPayments };
}

async function enviar(evento: string) {
  const corpo = JSON.stringify({ event: evento, data: { id: "prov-1" } });
  const { POST } = await import("@/app/api/v1/webhooks/payments/paysuite/[token]/route");
  const req = new NextRequest(`http://localhost/api/v1/webhooks/payments/paysuite/${TOKEN}`, {
    method: "POST",
    headers: { "x-signature": assinar(corpo) },
    body: corpo,
  });
  return POST(req, { params: Promise.resolve({ token: TOKEN }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(decryptWebhookSecret).mockResolvedValue(SECRET);
  vi.mocked(lerConfigDaFaturacao).mockResolvedValue({ organizationId: ORG_QUE_RECEBE, ativaDesde: "2026-10-01", instrucoesDeTransferencia: null, emailsDoFornecedor: [] });
});

describe("webhook do PaySuite × facturas de pacote", () => {
  it("pagamento da factura, no webhook da organização que recebe: dá a factura como paga", async () => {
    const { db, tocouEmPayments } = banco({ dono: ORG_QUE_RECEBE, fatura: FATURA });
    vi.mocked(createAdminClient).mockReturnValue(db as never);

    const r = await enviar("payment.success");
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ data: { status: "processed", alvo: "factura" } });
    expect(registrarPagamentoDeFatura).toHaveBeenCalledTimes(1);
    expect(vi.mocked(registrarPagamentoDeFatura).mock.calls[0]![1]).toMatchObject({ id: "fat-1" });
    // o outro mundo (pagamento de negócio) não é tocado
    expect(tocouEmPayments).not.toHaveBeenCalled();
  });

  it("webhook de OUTRA organização nunca fecha factura de pacote", async () => {
    const { db } = banco({ dono: OUTRA_ORG, fatura: FATURA });
    vi.mocked(createAdminClient).mockReturnValue(db as never);

    await enviar("payment.success");
    expect(registrarPagamentoDeFatura).not.toHaveBeenCalled();
  });

  it("pagamento falhado não fecha a factura (a reconciliação renova o link)", async () => {
    const { db } = banco({ dono: ORG_QUE_RECEBE, fatura: FATURA });
    vi.mocked(createAdminClient).mockReturnValue(db as never);

    const r = await enviar("payment.failed");
    expect(r.status).toBe(200);
    expect(registrarPagamentoDeFatura).not.toHaveBeenCalled();
  });

  it("se a faturação está desligada, o webhook segue só o caminho dos negócios", async () => {
    vi.mocked(lerConfigDaFaturacao).mockResolvedValue(null);
    const { db, tocouEmPayments } = banco({ dono: ORG_QUE_RECEBE, fatura: FATURA });
    vi.mocked(createAdminClient).mockReturnValue(db as never);

    await enviar("payment.success");
    expect(registrarPagamentoDeFatura).not.toHaveBeenCalled();
    expect(tocouEmPayments).toHaveBeenCalled();
  });

  it("pagamento que não é de factura segue para os negócios", async () => {
    const { db, tocouEmPayments } = banco({ dono: ORG_QUE_RECEBE, fatura: null });
    vi.mocked(createAdminClient).mockReturnValue(db as never);

    await enviar("payment.success");
    expect(registrarPagamentoDeFatura).not.toHaveBeenCalled();
    expect(tocouEmPayments).toHaveBeenCalled();
  });

  it("erro ao fechar a factura responde 500 (para o PaySuite reenviar)", async () => {
    vi.mocked(registrarPagamentoDeFatura).mockRejectedValueOnce(new Error("banco fora"));
    const { db } = banco({ dono: ORG_QUE_RECEBE, fatura: FATURA });
    vi.mocked(createAdminClient).mockReturnValue(db as never);

    expect((await enviar("payment.success")).status).toBe(500);
  });
});
