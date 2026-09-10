/**
 * Fix 4 (revisão final do plano "licenciamento por tenant") — `max_users` era
 * contornável convidando um de cada vez: o enforcement do Task 10 só conta
 * memberships JÁ aceitas no momento do ENVIO do convite. Um admin a 19/20
 * assentos podia disparar 20 convites individuais (cada um passa "19+1<=20"
 * isolado) e, se todos forem aceitos, estourar o pacote — porque o aceite
 * nunca reconsultava o limite no momento em que o assento é DE FATO
 * consumido. Este teste prova que `acceptInviteAction` agora reconta
 * `limitesDoTenant` no aceite, inclusive quando o estouro só existe por
 * causa de OUTROS aceites concorrentes (o convite em si foi assinado quando
 * havia vaga).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { limitesDoTenant } from "@/lib/plans/limiteDoTenant";
import { signInviteToken } from "@/lib/auth/invite-token";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/plans/limiteDoTenant", () => ({ limitesDoTenant: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "44444444-4444-4444-8444-444444444444";
const EMAIL = "novo-membro@example.com";

function tokenPara(overrides: Partial<Parameters<typeof signInviteToken>[0]> = {}) {
  return signInviteToken({
    invite_id: "55555555-5555-4555-8555-555555555555",
    email: EMAIL,
    organization_id: ORG_ID,
    role: "agent",
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  });
}

function mockAuthUser() {
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: USER_ID, email: EMAIL } } }) },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthUser();
});

describe("acceptInviteAction — reconta max_users no aceite (não só no envio)", () => {
  it("limite já atingido por OUTROS aceites concorrentes → recusa mesmo com convite válido", async () => {
    vi.mocked(limitesDoTenant).mockResolvedValue({
      planSlug: "essencial",
      planDisplayName: "Essencial",
      maxUsers: 20,
      maxWhatsappConnections: 3,
    });

    vi.mocked(createAdminClient).mockReturnValue({
      from: (table: string) => {
        if (table === "user_organizations") {
          return {
            select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
              if (opts?.count === "exact") {
                // 20 assentos já ocupados por outros aceites concorrentes.
                return {
                  eq: () => ({ is: async () => ({ count: 20, error: null }) }),
                };
              }
              return {
                eq: () => ({
                  eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
                }),
              };
            },
            insert: () => {
              throw new Error("não deveria inserir — limite deveria ter barrado antes");
            },
          };
        }
        throw new Error(`tabela não simulada: ${table}`);
      },
    } as never);

    const { acceptInviteAction } = await import("./acceptInvite");
    const result = await acceptInviteAction(tokenPara());

    expect(result).toEqual({
      ok: false,
      error: "plan_limit_reached",
      message: expect.stringContaining("Essencial"),
    });
  });

  it("dentro do limite → cria a membership normalmente", async () => {
    vi.mocked(limitesDoTenant).mockResolvedValue({
      planSlug: "essencial",
      planDisplayName: "Essencial",
      maxUsers: 20,
      maxWhatsappConnections: 3,
    });

    let inserted: unknown = null;
    vi.mocked(createAdminClient).mockReturnValue({
      from: (table: string) => {
        if (table === "user_organizations") {
          return {
            select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
              if (opts?.count === "exact") {
                return {
                  eq: () => ({ is: async () => ({ count: 5, error: null }) }),
                };
              }
              return {
                eq: () => ({
                  eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
                }),
              };
            },
            insert: (v: unknown) => {
              inserted = v;
              return { select: () => ({ single: async () => ({ data: { id: "membership-1" }, error: null }) }) };
            },
          };
        }
        throw new Error(`tabela não simulada: ${table}`);
      },
    } as never);

    const { acceptInviteAction } = await import("./acceptInvite");
    // redirect() lança internamente no Next real; aqui está mockado como no-op.
    await acceptInviteAction(tokenPara());

    expect(inserted).toMatchObject({ organization_id: ORG_ID, user_id: USER_ID, role: "agent" });
  });

  it("sem assinatura vigente (limitesDoTenant null) → fail-open, não bloqueia", async () => {
    vi.mocked(limitesDoTenant).mockResolvedValue(null);

    let inserted: unknown = null;
    vi.mocked(createAdminClient).mockReturnValue({
      from: (table: string) => {
        if (table === "user_organizations") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
              }),
            }),
            insert: (v: unknown) => {
              inserted = v;
              return { select: () => ({ single: async () => ({ data: { id: "membership-1" }, error: null }) }) };
            },
          };
        }
        throw new Error(`tabela não simulada: ${table}`);
      },
    } as never);

    const { acceptInviteAction } = await import("./acceptInvite");
    await acceptInviteAction(tokenPara());

    expect(inserted).toMatchObject({ organization_id: ORG_ID, user_id: USER_ID });
  });
});
