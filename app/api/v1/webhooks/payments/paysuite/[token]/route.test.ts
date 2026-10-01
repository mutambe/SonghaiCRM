import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/webhooks/secrets", () => ({ decryptWebhookSecret: vi.fn() }));
vi.mock("@/lib/leads/activity-emitter", () => ({ emitLeadActivity: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const TOKEN = "abcdef0123456789abcdef0123456789";
const SECRET = "webhook-secret";
const CRED = { organization_id: ORG_ID, webhook_secret_encrypted: "enc" };

function assinar(body: string): string {
  return createHmac("sha256", SECRET).update(body).digest("hex");
}

/**
 * Falso cliente: qualquer encadeamento (`eq`, `neq`, `select`) devolve o mesmo
 * construtor; `maybeSingle` responde conforme a operação — o UPDATE (que só acha
 * linha quando o status muda) ou o SELECT de existência que vem depois dele.
 */
function makeAdminStub(opts: {
  cred?: typeof CRED | null;
  /** O que o UPDATE condicional devolve (null = nada mudou). */
  updateResult?: { id: string; lead_id: string | null; amount_cents: number; currency: string } | null;
  /** Se a linha EXISTE (para distinguir reentrega de pagamento desconhecido). */
  existe?: boolean;
}) {
  const construtor = (resultado: () => unknown) => {
    const b: Record<string, unknown> = {};
    for (const m of ["eq", "neq", "select"]) b[m] = () => b;
    b.maybeSingle = async () => ({ data: resultado(), error: null });
    return b;
  };
  return {
    from(table: string) {
      if (table === "payment_credentials") return { select: () => construtor(() => opts.cred ?? null) };
      if (table === "payments") {
        return {
          update: () => construtor(() => opts.updateResult ?? null),
          select: () => construtor(() => (opts.existe ? { id: "pay-1" } : null)),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

function req(body: string, signature: string | null): NextRequest {
  const headers: Record<string, string> = {};
  if (signature) headers["x-signature"] = signature;
  return new NextRequest(`http://localhost/api/v1/webhooks/payments/paysuite/${TOKEN}`, { method: "POST", headers, body });
}

async function enviar(body: string, assinatura: string | null = assinar(body), token = TOKEN) {
  const { POST } = await import("./route");
  return POST(req(body, assinatura), { params: Promise.resolve({ token }) });
}

const SUCESSO = JSON.stringify({ event: "payment.success", data: { id: "prov-1" } });

beforeEach(() => {
  vi.mocked(emitLeadActivity).mockClear();
  vi.mocked(audit).mockClear();
  vi.mocked(decryptWebhookSecret).mockResolvedValue(SECRET);
});

describe("POST /api/v1/webhooks/payments/paysuite/[token]", () => {
  it("404 para token curto (nunca emitido por nós)", async () => {
    expect((await enviar("{}", null, "ab")).status).toBe(404);
  });

  it("404 quando o token não resolve credencial nenhuma", async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeAdminStub({ cred: null }) as never);
    expect((await enviar("{}", "sig")).status).toBe(404);
  });

  it("401 quando a assinatura é inválida", async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeAdminStub({ cred: CRED }) as never);
    expect((await enviar(SUCESSO, "assinatura-errada")).status).toBe(401);
  });

  it("401 quando o segredo não decifra (chave de cifra indisponível)", async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeAdminStub({ cred: CRED }) as never);
    vi.mocked(decryptWebhookSecret).mockResolvedValue(null);
    expect((await enviar(SUCESSO)).status).toBe(401);
  });

  it("200 'ignorado' para evento desconhecido, mesmo com assinatura válida", async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeAdminStub({ cred: CRED }) as never);
    const res = await enviar(JSON.stringify({ event: "payment.refunded", data: { id: "x" } }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { reason: string } }).data.reason).toBe("evento_desconhecido");
  });

  it("200 'ignorado' quando não há pagamento correspondente (não reentrega para sempre)", async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeAdminStub({ cred: CRED, updateResult: null, existe: false }) as never);
    const res = await enviar(JSON.stringify({ event: "payment.success", data: { id: "nao-existe" } }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { reason: string } }).data.reason).toBe("pagamento_nao_encontrado");
  });

  it("200 'processed', regista 'Pagamento confirmado' no negócio e audita", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdminStub({ cred: CRED, updateResult: { id: "pay-1", lead_id: "lead-1", amount_cents: 150000, currency: "MZN" } }) as never,
    );
    const res = await enviar(SUCESSO);
    expect(res.status).toBe(200);
    expect(vi.mocked(emitLeadActivity)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ leadId: "lead-1", type: "payment_confirmed", reason: expect.stringMatching(/1500,00\sMTn/) }),
    );
    expect(vi.mocked(audit)).toHaveBeenCalledWith(expect.objectContaining({ action: "payment.status_changed", organizationId: ORG_ID }));
  });

  it("⭐ reentrega do mesmo payment.success: 200 'ja_processado' e NENHUMA segunda atividade", async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeAdminStub({ cred: CRED, updateResult: null, existe: true }) as never);
    const res = await enviar(SUCESSO);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { reason: string } }).data.reason).toBe("ja_processado");
    expect(vi.mocked(emitLeadActivity)).not.toHaveBeenCalled();
    expect(vi.mocked(audit)).not.toHaveBeenCalled();
  });

  it("pagamento falhado atualiza o status mas não escreve 'confirmado' na linha do tempo", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdminStub({ cred: CRED, updateResult: { id: "pay-1", lead_id: "lead-1", amount_cents: 150000, currency: "MZN" } }) as never,
    );
    const res = await enviar(JSON.stringify({ event: "payment.failed", data: { id: "prov-1" } }));
    expect(res.status).toBe(200);
    expect(vi.mocked(emitLeadActivity)).not.toHaveBeenCalled();
  });
});
