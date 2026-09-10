/**
 * POST /api/v1/team/invite — enforcement de `max_users` do plano (Task 10).
 *
 * `signInviteToken`/`buildInviteEmail` rodam de verdade (funções puras, sem
 * I/O) — só o que fala com banco/rede/plano é dublê: `requireRole`,
 * `createAdminClient`, `audit`+`isServiceRoleConfigured`, `sendEmail`,
 * `marcaDaSaida` e `limitesDoTenant`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { audit, isServiceRoleConfigured } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import type { AuthUser } from "@/lib/auth/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/resend";
import { marcaDaSaida } from "@/lib/branding/saida";
import type * as Saida from "@/lib/branding/saida";
import { limitesDoTenant } from "@/lib/plans/limiteDoTenant";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  isServiceRoleConfigured: vi.fn(() => true),
}));
vi.mock("@/lib/email/resend", () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/branding/saida", async (importOriginal) => {
  const actual = await importOriginal<typeof Saida>();
  return { ...actual, marcaDaSaida: vi.fn() };
});
vi.mock("@/lib/plans/limiteDoTenant", () => ({ limitesDoTenant: vi.fn(async () => null) }));

const ORG = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";

type Linha = Record<string, unknown>;

/** `user_organizations` com N membros ativos + o `getUserById` que resolve email. */
function makeDb(memberEmails: string[]): void {
  const membros: Linha[] = memberEmails.map((email, i) => ({
    user_id: `member-${i}`,
    organization_id: ORG,
    revoked_at: null,
    email,
  }));

  class Q implements PromiseLike<{ data: unknown; error: unknown }> {
    private filtros: Array<[string, unknown]> = [];
    constructor(private readonly rows: Linha[]) {}
    eq(col: string, val: unknown): this {
      this.filtros.push([col, val]);
      return this;
    }
    is(col: string, val: unknown): this {
      this.filtros.push([col, val]);
      return this;
    }
    then<R1 = unknown, R2 = never>(
      onOk?: ((v: { data: unknown; error: unknown }) => R1 | PromiseLike<R1>) | null,
      onErr?: ((r: unknown) => R2 | PromiseLike<R2>) | null,
    ): PromiseLike<R1 | R2> {
      const data = this.rows.filter((l) => this.filtros.every(([c, v]) => (l[c] ?? null) === v));
      return Promise.resolve({ data, error: null }).then(onOk, onErr);
    }
  }

  const client = {
    from: (_table: string) => ({ select: () => new Q(membros) }),
    auth: {
      admin: {
        getUserById: async (userId: string) => {
          const m = membros.find((x) => x.user_id === userId);
          return { data: { user: m ? { email: m.email } : null } };
        },
      },
    },
  };

  vi.mocked(createAdminClient).mockReturnValue(client as never);
}

function authOk(): void {
  const user: AuthUser = {
    id: USER,
    email: "admin@example.com",
    full_name: "Admin",
    avatar_url: null,
    is_platform_admin: false,
    organizations: [{ organization_id: ORG, organization_name: "Org", role: "admin" }],
  };
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user,
    org: { orgId: ORG, name: "Org", role: "admin" },
  });
}

function reqInvite(invitations: Array<{ email: string; role: string }>) {
  return new NextRequest("http://localhost/api/v1/team/invite", {
    method: "POST",
    body: JSON.stringify({ invitations }),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isServiceRoleConfigured).mockReturnValue(true);
  vi.mocked(sendEmail).mockResolvedValue({ ok: true } as never);
  vi.mocked(marcaDaSaida).mockResolvedValue({
    nome: "SonghaiCRM",
    logoUrl: null,
    accent: "#000000",
    accentFg: "#ffffff",
    origens: { nome: "padrao", cor: "padrao" },
  } as never);
});

describe("POST /api/v1/team/invite — enforcement de max_users", () => {
  it("sem assinatura vigente (limitesDoTenant → null) não bloqueia", async () => {
    authOk();
    makeDb([]);
    vi.mocked(limitesDoTenant).mockResolvedValue(null);
    const { POST } = await import("./route");
    const res = await POST(reqInvite([{ email: "novo@example.com", role: "agent" }]));
    expect(res.status).toBe(201);
  });

  it("recusa convite quando max_users já foi atingido", async () => {
    authOk();
    makeDb(["existente@example.com"]); // 1 membro ativo == o limite do plano
    vi.mocked(limitesDoTenant).mockResolvedValue({
      planSlug: "agente_simples",
      planDisplayName: "Agente Simples",
      maxUsers: 1,
      maxWhatsappConnections: 1,
    });
    const { POST } = await import("./route");
    const res = await POST(reqInvite([{ email: "novo@example.com", role: "agent" }]));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("plan_limit_reached");
    expect(sendEmail).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("convite que só re-endereça quem já é membro não conta para o limite", async () => {
    authOk();
    makeDb(["existente@example.com"]);
    vi.mocked(limitesDoTenant).mockResolvedValue({
      planSlug: "agente_simples",
      planDisplayName: "Agente Simples",
      maxUsers: 1,
      maxWhatsappConnections: 1,
    });
    const { POST } = await import("./route");
    // Não é um convite NOVO: `existente@example.com` já é membro ativo, então
    // não deveria contar para o total pós-convite (que continuaria em 1).
    const res = await POST(reqInvite([{ email: "existente@example.com", role: "agent" }]));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.failed).toEqual([{ email: "existente@example.com", reason: "already_member" }]);
  });

  it("dentro do limite → convite segue normalmente", async () => {
    authOk();
    makeDb([]); // 0 membros, limite 5
    vi.mocked(limitesDoTenant).mockResolvedValue({
      planSlug: "profissional",
      planDisplayName: "Profissional",
      maxUsers: 5,
      maxWhatsappConnections: 3,
    });
    const { POST } = await import("./route");
    const res = await POST(reqInvite([{ email: "novo@example.com", role: "agent" }]));
    expect(res.status).toBe(201);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});
