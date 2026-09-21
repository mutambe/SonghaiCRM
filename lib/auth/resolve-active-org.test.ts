/**
 * `resolveActiveOrg` — prioridade do cookie de impersonate (S-11.07).
 *
 * O defeito: o platform admin clicava "Impersonate" num tenant, o banner dizia
 * "atuando como X", mas TODA página de `/app/*` (inbox, contatos, settings...)
 * chamava `resolveActiveOrg`, que só olhava `authUser.organizations` (as orgs de
 * que o platform admin é membro DE VERDADE) + o cookie `active_org` normal. O
 * cookie `deskcomm-impersonate` nunca era consultado ali — então os dados
 * mostrados eram os da própria org do admin (ou nenhuma), com o rótulo do
 * tenant errado por cima.
 *
 * Estas provas travam a ordem de prioridade certa: impersonate > active_org >
 * primeira membership > null.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieJar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name) } : undefined),
  }),
}));

vi.mock("@/lib/impersonate/cookie", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/impersonate/cookie")>("@/lib/impersonate/cookie");
  return {
    IMPERSONATE_COOKIE_NAME: actual.IMPERSONATE_COOKIE_NAME,
    verifyImpersonateCookie: vi.fn(),
  };
});

const orgLookup: { data: { id: string; display_name: string } | null; error: unknown } = {
  data: null,
  error: null,
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => orgLookup,
        }),
      }),
    }),
  }),
}));

const { resolveActiveOrg } = await import("@/lib/auth/server");
const { verifyImpersonateCookie, IMPERSONATE_COOKIE_NAME } = await import("@/lib/impersonate/cookie");
import type { AuthUser } from "@/lib/auth/types";

const PLATFORM_ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const OWN_ORG_ID = "22222222-2222-4222-8222-222222222222";
const TENANT_ID = "33333333-3333-4333-8333-333333333333";

function authUserFixture(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: PLATFORM_ADMIN_ID,
    email: "admin@platform.com",
    full_name: null,
    avatar_url: null,
    is_platform_admin: true,
    organizations: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieJar.clear();
  orgLookup.data = null;
  orgLookup.error = null;
});

describe("resolveActiveOrg — impersonate (S-11.07) vence membership", () => {
  it("cookie de impersonate válido devolve o TENANT, mesmo sem o admin ser membro", async () => {
    cookieJar.set(IMPERSONATE_COOKIE_NAME, "token-valido");
    vi.mocked(verifyImpersonateCookie).mockReturnValue({
      valid: true,
      payload: { tenantId: TENANT_ID, platformAdminId: PLATFORM_ADMIN_ID, exp: 9999999999 },
    });
    orgLookup.data = { id: TENANT_ID, display_name: "Egídio Comercial" };

    const result = await resolveActiveOrg(authUserFixture({ organizations: [] }));

    expect(result).toEqual({ orgId: TENANT_ID, name: "Egídio Comercial", role: "admin" });
  });

  it("impersonate vence até um active_org cookie apontando pra outra org", async () => {
    cookieJar.set(IMPERSONATE_COOKIE_NAME, "token-valido");
    cookieJar.set("active_org", OWN_ORG_ID);
    vi.mocked(verifyImpersonateCookie).mockReturnValue({
      valid: true,
      payload: { tenantId: TENANT_ID, platformAdminId: PLATFORM_ADMIN_ID, exp: 9999999999 },
    });
    orgLookup.data = { id: TENANT_ID, display_name: "Egídio Comercial" };

    const result = await resolveActiveOrg(
      authUserFixture({
        organizations: [{ organization_id: OWN_ORG_ID, organization_name: "Minha Org", role: "admin" }],
      }),
    );

    expect(result?.orgId).toBe(TENANT_ID);
  });

  it("cookie com platformAdminId de OUTRO usuário é ignorado (browser compartilhado)", async () => {
    cookieJar.set(IMPERSONATE_COOKIE_NAME, "token-de-outro-admin");
    vi.mocked(verifyImpersonateCookie).mockReturnValue({
      valid: true,
      payload: { tenantId: TENANT_ID, platformAdminId: "outro-admin-id", exp: 9999999999 },
    });

    const result = await resolveActiveOrg(authUserFixture({ organizations: [] }));

    expect(result).toBeNull();
  });

  it("cookie inválido (expirado/adulterado) cai pro fluxo normal", async () => {
    cookieJar.set(IMPERSONATE_COOKIE_NAME, "token-expirado");
    vi.mocked(verifyImpersonateCookie).mockReturnValue({ valid: false, reason: "expired" });

    const result = await resolveActiveOrg(
      authUserFixture({
        organizations: [{ organization_id: OWN_ORG_ID, organization_name: "Minha Org", role: "viewer" }],
      }),
    );

    expect(result).toEqual({ orgId: OWN_ORG_ID, name: "Minha Org", role: "viewer" });
  });

  it("sem cookie de impersonate, comportamento de sempre (active_org > primeira membership)", async () => {
    const result = await resolveActiveOrg(
      authUserFixture({
        organizations: [{ organization_id: OWN_ORG_ID, organization_name: "Minha Org", role: "manager" }],
      }),
    );

    expect(result).toEqual({ orgId: OWN_ORG_ID, name: "Minha Org", role: "manager" });
  });

  it("tenant do cookie foi deletado/não existe mais → cai pro fluxo normal em vez de vazar null", async () => {
    cookieJar.set(IMPERSONATE_COOKIE_NAME, "token-valido");
    vi.mocked(verifyImpersonateCookie).mockReturnValue({
      valid: true,
      payload: { tenantId: TENANT_ID, platformAdminId: PLATFORM_ADMIN_ID, exp: 9999999999 },
    });
    orgLookup.data = null; // tenant sumiu

    const result = await resolveActiveOrg(
      authUserFixture({
        organizations: [{ organization_id: OWN_ORG_ID, organization_name: "Minha Org", role: "admin" }],
      }),
    );

    expect(result?.orgId).toBe(OWN_ORG_ID);
  });
});
