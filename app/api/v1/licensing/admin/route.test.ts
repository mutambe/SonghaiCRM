import { describe, expect, it, vi, beforeEach } from "vitest";

const { loadAuthUserMock, insertInstallMock, insertLicenseMock, orderMock } = vi.hoisted(() => ({
  loadAuthUserMock: vi.fn(),
  insertInstallMock: vi.fn(),
  insertLicenseMock: vi.fn(),
  orderMock: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({ loadAuthUser: loadAuthUserMock }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "licensing_installs") {
        return {
          insert: () => ({
            select: () => ({
              single: insertInstallMock,
            }),
          }),
        };
      }
      return {
        select: () => ({ order: orderMock }),
        insert: () => ({
          select: () => ({
            single: insertLicenseMock,
          }),
        }),
      };
    },
  }),
}));

import { GET, POST } from "./route";

function req(body: unknown) {
  return new Request("http://localhost/api/v1/licensing/admin", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/licensing/admin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("recusa quem não é platform admin", async () => {
    loadAuthUserMock.mockResolvedValue({ id: "u1", is_platform_admin: false });
    const res = await POST(req({ customer_name: "X", contact_email: "a@b.com", plan_amount_cents: 5000 }) as never);
    expect(res.status).toBe(403);
  });

  it("recusa payload inválido", async () => {
    loadAuthUserMock.mockResolvedValue({ id: "u1", is_platform_admin: true });
    const res = await POST(req({ customer_name: "" }) as never);
    expect(res.status).toBe(422);
  });

  it("cria install + license trial e devolve a chave", async () => {
    loadAuthUserMock.mockResolvedValue({ id: "u1", is_platform_admin: true });
    insertInstallMock.mockResolvedValue({ data: { id: "install-1" }, error: null });
    insertLicenseMock.mockResolvedValue({
      data: { id: "lic-1", license_key: "abc123", current_period_end: "2026-09-11T00:00:00.000Z" },
      error: null,
    });

    const res = await POST(
      req({ customer_name: "Loja X", contact_email: "loja@x.com", plan_amount_cents: 500000 }) as never,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { license_key: string } };
    expect(body.data.license_key).toBe("abc123");
  });
});

describe("GET /api/v1/licensing/admin", () => {
  beforeEach(() => vi.clearAllMocks());

  it("recusa quem não é platform admin", async () => {
    loadAuthUserMock.mockResolvedValue({ id: "u1", is_platform_admin: false });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("lista licenças com o nome/email do install", async () => {
    loadAuthUserMock.mockResolvedValue({ id: "u1", is_platform_admin: true });
    orderMock.mockResolvedValue({
      data: [
        {
          id: "lic-1",
          license_key: "abc123",
          status: "trial",
          plan_amount_cents: 500000,
          current_period_end: "2026-09-11T00:00:00.000Z",
          created_at: "2026-09-04T00:00:00.000Z",
          licensing_installs: { customer_name: "Loja X", contact_email: "loja@x.com" },
        },
      ],
      error: null,
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ license_key: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.license_key).toBe("abc123");
  });
});
