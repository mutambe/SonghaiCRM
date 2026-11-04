/**
 * SonghaiCRM — administração da organização pelo painel da plataforma (porte
 * do `b1b1eb812` do fork sobre o modelo de convite do upstream): editar,
 * apagar a organização sem uso e convidar/trocar o responsável.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  platform: vi.fn(),
  mfa: vi.fn(),
  suporte: vi.fn(),
  audit: vi.fn(),
  emitir: vi.fn(),
  responsavel: vi.fn(),
  /** Resultado por tabela+operação: "organizations:select", "organizations:update", ... */
  respostas: new Map<string, unknown>(),
  chamadas: [] as Array<{ tabela: string; op: string; args: unknown[] }>,
}));

// SonghaiCRM: as rotas usam o helper de ESCRITA do upstream (#2078); o mock o
// reproduz sobre os mesmos dublês (`h.platform`, `h.mfa`).
vi.mock("@/lib/auth/requirePlatformAdmin", async () => {
  const { EscritaDePlatformAdminNegada } = await import("@/lib/auth/recusa-de-escrita-de-admin");
  const { fail } = await import("@/lib/api/wrappers");
  return {
    requirePlatformAdmin: h.platform,
    requirePlatformAdminEscrita: async () => {
      const c = await h.platform();
      if (c.platformAdmin.scope !== "full") throw new EscritaDePlatformAdminNegada("forbidden_scope");
      if (await h.mfa()) throw new EscritaDePlatformAdminNegada("mfa_required");
      return c;
    },
    falhaDaEscritaDePlatformAdmin: (err: unknown, requestId?: string) =>
      err instanceof EscritaDePlatformAdminNegada
        ? fail(err.code, err.message, 403, { requestId })
        : fail("forbidden", "Platform admin required", 403, { requestId }),
  };
});
vi.mock("@/lib/auth/server", () => ({ mfaEmDivida: h.mfa }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: h.suporte }));
vi.mock("@/lib/audit", () => ({ audit: h.audit, hashEmail: (e: string) => `hash:${e}` }));
vi.mock("@/lib/team/convites", () => ({ emitirConvite: h.emitir }));
vi.mock("@/lib/admin/responsavel-da-organizacao", () => ({ responsavelDaOrganizacao: h.responsavel }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => {
      let op = "select";
      const b: Record<string, unknown> = {};
      const resultado = () => h.respostas.get(`${tabela}:${op}`) ?? { data: null, error: null, count: 0 };
      for (const m of ["select", "update", "delete", "insert", "upsert", "eq", "neq", "is", "not", "order", "limit"]) {
        b[m] = (...args: unknown[]) => {
          if (["update", "delete", "insert", "upsert"].includes(m)) op = m;
          h.chamadas.push({ tabela, op: m, args });
          return b;
        };
      }
      b.maybeSingle = async () => resultado();
      b.single = async () => resultado();
      b.then = (ok: (v: unknown) => unknown) => Promise.resolve(resultado()).then(ok);
      return b;
    },
  }),
}));

import { POST as convidarResponsavel } from "@/app/api/v1/admin/tenants/[id]/owner/route";
import { colunasDaEdicao, edicaoDaOrganizacaoSchema, organizacaoTemUso } from "@/lib/admin/edicao-da-organizacao";

const ORG = "22222222-2222-4222-8222-222222222222";
const ctx = { params: Promise.resolve({ id: ORG }) };
const pedido = (method: string, body: unknown) =>
  new NextRequest(`http://localhost/api/v1/admin/tenants/${ORG}`, { method, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  h.respostas.clear();
  h.chamadas.length = 0;
  h.suporte.mockResolvedValue(null);
  h.mfa.mockResolvedValue(false);
  h.platform.mockResolvedValue({ user: { id: "admin-1", email: "admin@songhai.co.mz" }, platformAdmin: { scope: "full" } });
});

describe("regras de edição", () => {
  it("NUIT vai para a coluna do upstream só com dígitos; vazio apaga", () => {
    expect(colunasDaEdicao(edicaoDaOrganizacaoSchema.parse({ nuit: "123 456 789" }))).toEqual({ cnpj: "123456789" });
    expect(colunasDaEdicao(edicaoDaOrganizacaoSchema.parse({ nuit: "" }))).toEqual({ cnpj: null });
  });

  it("recusa NUIT fora da forma, slug com maiúsculas e pedido vazio", () => {
    expect(edicaoDaOrganizacaoSchema.safeParse({ nuit: "12345" }).success).toBe(false);
    expect(edicaoDaOrganizacaoSchema.safeParse({ nuit: "111111111" }).success).toBe(false);
    expect(edicaoDaOrganizacaoSchema.safeParse({ slug: "Loja" }).success).toBe(false);
    expect(edicaoDaOrganizacaoSchema.safeParse({}).success).toBe(false);
  });

  it("qualquer uso real impede apagar", () => {
    const zero = { membros_ativos: 0, conversas: 0, mensagens: 0, negocios: 0, pedidos: 0, canais: 0 };
    expect(organizacaoTemUso(zero)).toBe(false);
    expect(organizacaoTemUso({ ...zero, canais: 1 })).toBe(true);
  });
});

// SonghaiCRM: o PATCH e o DELETE do cadastro da organização passaram a ser os do
// upstream (`route.ts`, `delete/`); o que fica aqui é a regra pura e o convite do responsável.

describe("POST /api/v1/admin/tenants/[id]/owner", () => {
  const emissao = {
    convite: { expires_at: "2026-10-02T10:00:00Z" },
    accept_url: "http://localhost/team/accept-invite/tok",
    email_dispatched: false,
    renovado: false,
  };

  it("troca o e-mail: revoga os OUTROS convites de admin antes de emitir o novo", async () => {
    h.respostas.set("organizations:select", { data: { id: ORG, display_name: "Loja", status: "active" }, error: null });
    h.responsavel.mockResolvedValue({ estado: "convite_pendente", email: "errado@x.co.mz" });
    h.emitir.mockResolvedValue(emissao);
    const res = await convidarResponsavel(pedido("POST", { email: "Certo@X.co.mz" }), ctx);
    expect(res.status).toBe(200);
    expect(h.chamadas).toContainEqual({ tabela: "team_invites", op: "neq", args: ["email", "certo@x.co.mz"] });
    const ordem = h.chamadas.findIndex((c) => c.tabela === "team_invites" && c.op === "update");
    expect(ordem).toBeGreaterThanOrEqual(0);
    expect(h.emitir).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ email: "certo@x.co.mz", role: "admin", organizationId: ORG }));
    expect(h.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "tenant.owner_invited_by_platform_admin",
        metadata: expect.objectContaining({ previous_owner_email_hash: "hash:errado@x.co.mz" }),
      }),
    );
  });

  it("com responsável ativo → 409, nada emitido", async () => {
    h.respostas.set("organizations:select", { data: { id: ORG, display_name: "Loja", status: "active" }, error: null });
    h.responsavel.mockResolvedValue({ estado: "ativo", email: "dono@x.co.mz", desde: "2026-09-01" });
    expect((await convidarResponsavel(pedido("POST", { email: "outro@x.co.mz" }), ctx)).status).toBe(409);
    expect(h.emitir).not.toHaveBeenCalled();
  });

  it("e-mail inválido → 400", async () => {
    expect((await convidarResponsavel(pedido("POST", { email: "nao-e-email" }), ctx)).status).toBe(400);
  });
});
