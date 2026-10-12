/**
 * SonghaiCRM — a borda do cron da faturação (app/api/v1/cron/billing).
 *
 * O motor tem as suas provas em `faturacao-rodada.test.ts`; aqui só a fronteira:
 * quem pode chamar, e o que acontece quando a faturação não foi ligada.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { autorizaCron } from "@/lib/auth/cron-auth";
import { lerConfigDaFaturacao } from "@/lib/billing/config";
import { rodarFaturacao } from "@/lib/billing/executar";

vi.mock("@/lib/auth/cron-auth", () => ({ autorizaCron: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/billing/config", () => ({ lerConfigDaFaturacao: vi.fn() }));
vi.mock("@/lib/billing/dependencias", () => ({ dependenciasReais: vi.fn(async () => ({ marca: "deps" })) }));
vi.mock("@/lib/billing/executar", () => ({ rodarFaturacao: vi.fn() }));

const req = () => new NextRequest("http://localhost/api/v1/cron/billing", { method: "POST" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(autorizaCron).mockReturnValue(true);
});

describe("POST /api/v1/cron/billing", () => {
  it("sem segredo de cron: 403, e o motor nem é tocado", async () => {
    vi.mocked(autorizaCron).mockReturnValue(false);
    const { POST } = await import("@/app/api/v1/cron/billing/route");
    expect((await POST(req())).status).toBe(403);
    expect(lerConfigDaFaturacao).not.toHaveBeenCalled();
    expect(rodarFaturacao).not.toHaveBeenCalled();
  });

  it("faturação não ligada: sai na hora, sem emitir nem suspender nada", async () => {
    vi.mocked(lerConfigDaFaturacao).mockResolvedValue(null);
    const { POST } = await import("@/app/api/v1/cron/billing/route");
    const r = await POST(req());
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ data: { status: "desligada" } });
    expect(rodarFaturacao).not.toHaveBeenCalled();
  });

  it("ligada: corre a rodada e devolve o resumo", async () => {
    vi.mocked(lerConfigDaFaturacao).mockResolvedValue({ organizationId: "org-s", ativaDesde: "2026-10-01", instrucoesDeTransferencia: null, emailsDoFornecedor: [] });
    vi.mocked(rodarFaturacao).mockResolvedValue({ emitidas: 2, links: 2, pagas: 1, lembretes: 0, avisos: 0, suspensas: 0, reativadas: 0, avisosDeTokens: 0, erros: 0 });
    const { POST } = await import("@/app/api/v1/cron/billing/route");
    const r = await POST(req());
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ data: { status: "ok", emitidas: 2, pagas: 1 } });
    expect(rodarFaturacao).toHaveBeenCalledTimes(1);
  });

  it("a rodada rebentar responde 500 sem vazar o motivo", async () => {
    vi.mocked(lerConfigDaFaturacao).mockResolvedValue({ organizationId: "org-s", ativaDesde: "2026-10-01", instrucoesDeTransferencia: null, emailsDoFornecedor: [] });
    vi.mocked(rodarFaturacao).mockRejectedValue(new Error("segredo interno"));
    const { POST } = await import("@/app/api/v1/cron/billing/route");
    const r = await POST(req());
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("segredo interno");
  });

  it("está agendado de hora a hora no scheduler", async () => {
    const { readFileSync } = await import("node:fs");
    const texto = readFileSync("docker/scheduler/entrypoint.sh", "utf8");
    expect(texto).toMatch(/^17 \* \* \* \*\|\d+\|api\/v1\/cron\/billing$/m);
  });
});
