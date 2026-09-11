import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/v1/admin/tenants/[id] — cabeçalho do tenant no painel de plataforma.
 *
 * O contador de LGPD filtrava `status = 'pending'`, valor que não existe em
 * `lgpd_requests_status_check` (received/processing/completed/failed/expired):
 * era sempre 0, e a tela jurava que o tenant não devia nada à LGPD.
 *
 * O dublê abaixo aplica o filtro sobre linhas com status do vocabulário REAL —
 * é isso que faz o teste reprovar um predicado que compara com valor imaginado.
 */

vi.mock("@/lib/auth/requirePlatformAdmin", () => ({
  requirePlatformAdmin: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";

const ORG = {
  id: ORG_ID,
  slug: "org",
  display_name: "Org",
  legal_name: null,
  nuit: null,
  status: "active",
  onboarded_at: "2026-01-01T00:00:00Z",
  suspended_at: null,
  created_at: "2026-01-01T00:00:00Z",
  settings: {},
};

/** Linhas de lgpd_requests com status do vocabulário real do CHECK. */
const LGPD_ROWS = [
  { status: "received" },
  { status: "processing" },
  { status: "completed" },
  { status: "failed" },
];

type Filtro =
  | { kind: "eq"; col: string; val: unknown }
  | { kind: "not_in"; col: string; vals: string[] };

function lgpdBuilder() {
  const filtros: Filtro[] = [];
  const builder = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      filtros.push({ kind: "eq", col, val });
      return builder;
    },
    not: (col: string, op: string, list: string) => {
      if (op !== "in") throw new Error(`operador não simulado: ${op}`);
      filtros.push({
        kind: "not_in",
        col,
        vals: list.replace(/^\(|\)$/g, "").split(","),
      });
      return builder;
    },
    then(resolve: (v: { count: number; error: null }) => unknown) {
      const count = LGPD_ROWS.filter((row) =>
        filtros.every((f) => {
          if (f.col === "organization_id") return true;
          if (f.kind === "eq") return row.status === f.val;
          return !f.vals.includes(row.status);
        }),
      ).length;
      return Promise.resolve({ count, error: null }).then(resolve);
    },
  };
  return builder;
}

function contadorVazio() {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gte", "is", "not", "limit", "order"]) {
    builder[m] = () => builder;
  }
  builder.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ count: 0, data: [], error: null }).then(resolve);
  builder.single = async () => ({ data: ORG, error: null });
  builder.maybeSingle = async () => ({ data: null, error: null });
  return builder;
}

function makeAdminStub() {
  return {
    from: (table: string) =>
      table === "lgpd_requests" ? lgpdBuilder() : contadorVazio(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformAdmin).mockResolvedValue({
    user: { id: ADMIN_ID },
    platformAdmin: { user_id: ADMIN_ID, scope: "full", mfa_required: true },
  } as never);
  vi.mocked(createAdminClient).mockReturnValue(makeAdminStub() as never);
});

describe("GET /api/v1/admin/tenants/[id]", () => {
  it("conta como pendente o que o banco realmente grava (received/processing)", async () => {
    const { GET } = await import("./route");
    const res = await GET(
      new NextRequest(`http://localhost/api/v1/admin/tenants/${ORG_ID}`),
      { params: Promise.resolve({ id: ORG_ID }) },
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      data: { counts: { lgpd_requests_pending: number } };
    };
    expect(body.data.counts.lgpd_requests_pending).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// PATCH / DELETE — dublê de banco à parte (fixture mutável), mais fiel a
// update/delete/contagem do que o contadorVazio do teste de GET acima.
// ---------------------------------------------------------------------------

interface OrgFixture {
  id: string;
  slug: string;
  display_name: string;
  legal_name: string | null;
  nuit: string | null;
  status: string;
}

interface MutFixture {
  org: OrgFixture | null;
  members: Array<{ user_id: string; accepted_at: string | null }>;
  otherCounts: Partial<Record<string, number>>;
  deletedUsers: string[];
}

function orgTableBuilder(fx: MutFixture) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    update: (patch: Record<string, unknown>) => ({
      eq: () => ({
        select: () => ({
          single: async () => {
            if (!fx.org) return { data: null, error: { code: "PGRST116", message: "not found" } };
            if (
              typeof patch.slug === "string" &&
              patch.slug !== fx.org.slug &&
              patch.slug === "slug-tomado"
            ) {
              return { data: null, error: { code: "23505", message: "duplicate key" } };
            }
            Object.assign(fx.org, patch);
            return { data: { ...fx.org }, error: null };
          },
        }),
      }),
    }),
    delete: () => ({
      eq: async () => {
        fx.org = null;
        // ON DELETE CASCADE de verdade (organization_id → organizations):
        // apagar a org some com as linhas de user_organizations dela.
        fx.members = [];
        return { error: null };
      },
    }),
    maybeSingle: async () => ({ data: fx.org, error: null }),
  };
  return builder;
}

function memberTableBuilder(fx: MutFixture) {
  const builder = {
    select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
      type Row = MutFixture["members"][number];
      const filtros: Array<(m: Row) => boolean> = [];
      const chain = {
        eq: (col: string, val: unknown) => {
          // `organization_id` não existe nas linhas da fixture — ela já é
          // escopada a um único tenant, então esse filtro é sempre "true".
          if (col === "organization_id") return chain;
          filtros.push((m) => m[col as keyof Row] === val);
          return chain;
        },
        not: (col: keyof Row, op: string, val: null) => {
          if (op !== "is") throw new Error(`operador não simulado: ${op}`);
          filtros.push((m) => m[col] !== val);
          return chain;
        },
        then: (resolve: (v: unknown) => unknown) => {
          const rows = fx.members.filter((m) => filtros.every((f) => f(m)));
          const result = opts?.count ? { count: rows.length, error: null } : { data: rows, error: null };
          return Promise.resolve(result).then(resolve);
        },
      };
      return chain;
    },
  };
  return builder;
}

function genericCountBuilder(fx: MutFixture, table: string) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gte", "is", "not"]) {
    b[m] = () => b;
  }
  b.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ count: fx.otherCounts[table] ?? 0, error: null }).then(resolve);
  return b;
}

function makeMutAdminStub(fx: MutFixture) {
  return {
    from: (table: string) => {
      if (table === "organizations") return orgTableBuilder(fx);
      if (table === "user_organizations") return memberTableBuilder(fx);
      return genericCountBuilder(fx, table);
    },
    auth: {
      admin: {
        deleteUser: async (id: string) => {
          fx.deletedUsers.push(id);
          return { error: null };
        },
      },
    },
  };
}

function patchReq(body: unknown) {
  return new NextRequest(`http://localhost/api/v1/admin/tenants/${ORG_ID}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

function deleteReq(body: unknown) {
  return new NextRequest(`http://localhost/api/v1/admin/tenants/${ORG_ID}`, {
    method: "DELETE",
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/v1/admin/tenants/[id]", () => {
  let fx: MutFixture;

  beforeEach(() => {
    fx = {
      org: { id: ORG_ID, slug: "org", display_name: "Org", legal_name: null, nuit: null, status: "active" },
      members: [],
      otherCounts: {},
      deletedUsers: [],
    };
    vi.mocked(createAdminClient).mockReturnValue(makeMutAdminStub(fx) as never);
  });

  it("edita display_name — 200 e reflete o novo valor", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(patchReq({ display_name: "Loja Nova" }), {
      params: Promise.resolve({ id: ORG_ID }),
    });
    expect(res.status).toBe(200);
    expect(fx.org?.display_name).toBe("Loja Nova");
  });

  it("corpo vazio → 400 (nenhum campo)", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(patchReq({}), { params: Promise.resolve({ id: ORG_ID }) });
    expect(res.status).toBe(400);
  });

  it("slug já usado por outro tenant → 409 tenant_already_exists", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(patchReq({ slug: "slug-tomado" }), {
      params: Promise.resolve({ id: ORG_ID }),
    });
    expect(res.status).toBe(409);
  });

  it("tenant redigido → 409, não edita nada", async () => {
    fx.org!.status = "redacted";
    const { PATCH } = await import("./route");
    const res = await PATCH(patchReq({ display_name: "Outra" }), {
      params: Promise.resolve({ id: ORG_ID }),
    });
    expect(res.status).toBe(409);
    expect(fx.org?.display_name).toBe("Org");
  });

  it("tenant inexistente → 404", async () => {
    fx.org = null;
    const { PATCH } = await import("./route");
    const res = await PATCH(patchReq({ display_name: "Xx" }), {
      params: Promise.resolve({ id: ORG_ID }),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/v1/admin/tenants/[id]", () => {
  let fx: MutFixture;

  beforeEach(() => {
    fx = {
      org: { id: ORG_ID, slug: "egidio-comercial", display_name: "Egídio Comercial", legal_name: null, nuit: null, status: "active" },
      members: [],
      otherCounts: {},
      deletedUsers: [],
    };
    vi.mocked(createAdminClient).mockReturnValue(makeMutAdminStub(fx) as never);
  });

  it("tenant zerado (o caso real: convite errado, ninguém aceitou) — apaga e limpa o usuário órfão", async () => {
    fx.members = [{ user_id: "owner-fantasma", accepted_at: null }];
    const { DELETE } = await import("./route");
    const res = await DELETE(deleteReq({ slug_confirmation: "egidio-comercial" }), {
      params: Promise.resolve({ id: ORG_ID }),
    });
    expect(res.status).toBe(200);
    expect(fx.org).toBeNull();
    expect(fx.deletedUsers).toEqual(["owner-fantasma"]);
  });

  it("confirmação de slug errada → 422, não apaga nada", async () => {
    const { DELETE } = await import("./route");
    const res = await DELETE(deleteReq({ slug_confirmation: "slug-errado" }), {
      params: Promise.resolve({ id: ORG_ID }),
    });
    expect(res.status).toBe(422);
    expect(fx.org).not.toBeNull();
  });

  it("tenant com conversas reais → 409 tenant_has_data, não apaga", async () => {
    fx.otherCounts.conversations = 3;
    const { DELETE } = await import("./route");
    const res = await DELETE(deleteReq({ slug_confirmation: "egidio-comercial" }), {
      params: Promise.resolve({ id: ORG_ID }),
    });
    expect(res.status).toBe(409);
    expect(fx.org).not.toBeNull();
  });

  it("dono JÁ aceitou o convite (uso real) → 409, mesmo com todo o resto zerado", async () => {
    fx.members = [{ user_id: "dono-real", accepted_at: "2026-01-01T00:00:00Z" }];
    const { DELETE } = await import("./route");
    const res = await DELETE(deleteReq({ slug_confirmation: "egidio-comercial" }), {
      params: Promise.resolve({ id: ORG_ID }),
    });
    expect(res.status).toBe(409);
    expect(fx.org).not.toBeNull();
  });

  it("tenant inexistente → 404", async () => {
    fx.org = null;
    const { DELETE } = await import("./route");
    const res = await DELETE(deleteReq({ slug_confirmation: "egidio-comercial" }), {
      params: Promise.resolve({ id: ORG_ID }),
    });
    expect(res.status).toBe(404);
  });
});
