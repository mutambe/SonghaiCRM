/**
 * SonghaiCRM — pagar por transferência bancária.
 *
 * O PaySuite confirma sozinho M-Pesa, e-Mola e cartão; a transferência entra no
 * banco, onde o sistema não vê. Daí três coisas, todas provadas aqui: os dados do
 * banco chegam ao cliente (e-mail e telas), uma pessoa dá a factura como paga, e
 * isso passa pela MESMA via do PaySuite — reactiva a conta, agradece, audita.
 */
import { describe, expect, it, vi } from "vitest";

import {
  TAMANHO_MAXIMO_DAS_INSTRUCOES,
  gravarInstrucoesDeTransferencia,
  instrucoesDeTransferencia,
  lerConfigDaFaturacao,
} from "@/lib/billing/config";
import { montarEmail, type DadosDoEmail } from "@/lib/billing/emails";
import { registrarPagamentoDeFatura, type DependenciasDaRodada, type FaturaAberta } from "@/lib/billing/executar";

const BASE: DadosDoEmail = {
  organizacao: "Clínica Sol",
  amountCents: 800_000,
  currency: "MZN",
  vencimento: "2026-11-10",
  periodo: "2026-11-10",
  linkDePagamento: "https://pagar.exemplo/x",
};
const BANCO = "Banco X\nTitular: Songhai, Lda\nNIB 0000 1111 2222 3333";

describe("os dados do banco nas mensagens", () => {
  it("quem pede pagamento diz também como pagar por transferência", () => {
    for (const tipo of ["fatura_nova", "lembrete", "aviso_final", "suspensa"] as const) {
      const m = montarEmail(tipo, { ...BASE, instrucoesDeTransferencia: BANCO, suspensaoPrevista: "2026-11-17" });
      expect(m.texto, tipo).toContain("transferência bancária ou números de recepção");
      expect(m.texto, tipo).toContain("NIB 0000 1111 2222 3333");
      expect(m.html, tipo).toContain("Banco X");
    }
  });

  it("as linhas do banco vão numa só, separadas, para o parágrafo não partir", () => {
    const m = montarEmail("fatura_nova", { ...BASE, instrucoesDeTransferencia: BANCO });
    expect(m.texto).toContain("Banco X · Titular: Songhai, Lda · NIB 0000 1111 2222 3333");
  });

  it("mensagens que não pedem pagamento não repetem os dados", () => {
    for (const tipo of ["pagamento_recebido", "reativada"] as const) {
      expect(montarEmail(tipo, { ...BASE, instrucoesDeTransferencia: BANCO }).texto, tipo).not.toContain("transferência");
    }
  });

  it("sem dados definidos, nada aparece", () => {
    expect(montarEmail("fatura_nova", { ...BASE, instrucoesDeTransferencia: null }).texto).not.toContain("transferência");
    expect(montarEmail("fatura_nova", BASE).texto).not.toContain("transferência");
  });

  it("texto do operador não injecta HTML", () => {
    const m = montarEmail("fatura_nova", { ...BASE, instrucoesDeTransferencia: "<script>x</script>" });
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
  });
});

/** platform_config em memória: só o que a configuração usa. */
function configEmMemoria(inicial: Record<string, string> = {}) {
  const t = new Map(Object.entries(inicial));
  return {
    t,
    db: {
      from: () => {
        let filtro: string[] | string | null = null;
        const b: Record<string, unknown> = {
          select: () => b,
          in: (_c: string, v: string[]) => ((filtro = v), b),
          eq: (_c: string, v: string) => ((filtro = v), b),
          delete: () => ({ eq: async (_c: string, v: string) => (t.delete(v), { error: null }) }),
          upsert: async (linhas: Array<{ chave: string; valor: string }> | { chave: string; valor: string }) => {
            for (const l of Array.isArray(linhas) ? linhas : [linhas]) t.set(l.chave, l.valor);
            return { error: null };
          },
          maybeSingle: async () => {
            const v = typeof filtro === "string" ? t.get(filtro) : undefined;
            return { data: v === undefined ? null : { valor: v }, error: null };
          },
          then: (ok: (v: unknown) => unknown) =>
            Promise.resolve({
              data: [...t.entries()].filter(([k]) => Array.isArray(filtro) && filtro.includes(k)).map(([chave, valor]) => ({ chave, valor })),
              error: null,
            }).then(ok),
        };
        return b;
      },
    } as never,
  };
}

const ORG = "11111111-1111-4111-8111-111111111111";

describe("guardar e ler os dados do banco", () => {
  it("grava, lê com espaços aparados, e faz parte da configuração da faturação", async () => {
    const { db } = configEmMemoria({ BILLING_ORGANIZATION_ID: ORG });
    expect(await gravarInstrucoesDeTransferencia(db, `  ${BANCO}  `, "u1")).toBe(true);
    expect(await instrucoesDeTransferencia(db)).toBe(BANCO);
    expect((await lerConfigDaFaturacao(db))?.instrucoesDeTransferencia).toBe(BANCO);
  });

  it("vazio ou null apaga", async () => {
    const { db, t } = configEmMemoria({ BILLING_ORGANIZATION_ID: ORG, BILLING_TRANSFER_INSTRUCTIONS: BANCO });
    expect(await gravarInstrucoesDeTransferencia(db, "   ", "u1")).toBe(true);
    expect(t.has("BILLING_TRANSFER_INSTRUCTIONS")).toBe(false);
    expect(await instrucoesDeTransferencia(db)).toBeNull();
    expect((await lerConfigDaFaturacao(db))?.instrucoesDeTransferencia).toBeNull();
  });

  it("texto demasiado longo é recusado e nada se grava", async () => {
    const { db, t } = configEmMemoria({ BILLING_ORGANIZATION_ID: ORG });
    expect(await gravarInstrucoesDeTransferencia(db, "x".repeat(TAMANHO_MAXIMO_DAS_INSTRUCOES + 1), "u1")).toBe(false);
    expect(t.has("BILLING_TRANSFER_INSTRUCTIONS")).toBe(false);
  });

  it("os dados do banco sozinhos não ligam a faturação", async () => {
    const { db } = configEmMemoria({ BILLING_TRANSFER_INSTRUCTIONS: BANCO });
    expect(await lerConfigDaFaturacao(db)).toBeNull();
  });
});

describe("dar uma transferência como paga", () => {
  const fatura: FaturaAberta = {
    id: "fat-1", organization_id: "cliente-1", subscription_id: "sub-1", period_start: "2026-11-10", due_date: "2026-11-10",
    amount_cents: 800_000, currency: "MZN", reference: "r", provider_payment_id: null, checkout_url: null, reminded_at: null, warned_at: null,
  };

  function mundo() {
    const rpc = vi.fn(async (nome: string) => (nome === "fn_marcar_fatura_paga" ? { data: { changed: true }, error: null } : { data: { changed: false }, error: null }));
    const emails: string[] = [];
    const auditoria: Array<{ action: string; metadata?: Record<string, unknown> }> = [];
    const cadeia = (resultado: unknown) => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq"]) b[m] = () => b;
      b.maybeSingle = async () => ({ data: resultado, error: null });
      return b;
    };
    const deps = {
      db: { rpc, from: () => cadeia({ display_name: "Clínica Sol", status: "active", suspended_kind: null }) },
      cfg: { organizationId: ORG, ativaDesde: "2026-10-01", instrucoesDeTransferencia: BANCO, emailsDoFornecedor: [] },
      agora: new Date("2026-11-12T08:00:00Z"),
      gateway: null,
      emailsDosAdmins: async () => ["dono@clinicasol.co.mz"],
      enviarEmail: async (_p: string[], m: { assunto: string }) => (emails.push(m.assunto), true),
      suporte: null,
      auditar: (e: { action: string; metadata?: Record<string, unknown> }) => void auditoria.push(e),
    } as unknown as DependenciasDaRodada;
    return { rpc, emails, auditoria, deps };
  }

  it("passa a via 'transferencia' ao banco, agradece e audita quem a marcou e o comprovativo", async () => {
    const { rpc, emails, auditoria, deps } = mundo();
    const mudou = await registrarPagamentoDeFatura(deps, fatura, undefined, "transferencia", { ator: "user-phill", referencia: "TRF-9981" });

    expect(mudou).toBe(true);
    expect(rpc).toHaveBeenCalledWith("fn_marcar_fatura_paga", { p_invoice: "fat-1", p_provider_payment_id: null, p_via: "transferencia" });
    expect(emails).toEqual(["Pagamento recebido — obrigado"]);
    const pago = auditoria.find((a) => a.action === "billing.invoice_paid");
    expect(pago?.metadata).toMatchObject({ via: "transferencia", marked_by: "user-phill", proof_reference: "TRF-9981" });
  });

  it("por omissão a via é a do PaySuite", async () => {
    const { rpc, deps } = mundo();
    await registrarPagamentoDeFatura(deps, fatura);
    expect(rpc).toHaveBeenCalledWith("fn_marcar_fatura_paga", expect.objectContaining({ p_via: "paysuite" }));
  });

  it("factura que já não está em aberto: nada muda, ninguém é agradecido duas vezes", async () => {
    const { rpc, emails, deps } = mundo();
    rpc.mockResolvedValueOnce({ data: { changed: false }, error: null });
    expect(await registrarPagamentoDeFatura(deps, fatura, undefined, "transferencia")).toBe(false);
    expect(emails).toHaveLength(0);
  });
});
