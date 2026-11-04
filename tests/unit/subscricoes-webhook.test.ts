/**
 * Webhook de subscrição dos tenants (SonghaiCRM): o contrato do evento, a chave
 * de idempotência e as recusas da rota (desligada, assinatura, janela, formato).
 * A execução (criar, trocar, suspender) reusa as funções do admin e é provada
 * pelo `pnpm test:db`; aqui prova-se a PORTA.
 */
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { superficieInterna } from "@/lib/auth/limite-das-superficies-internas";
import { chaveDoEvento, eventoDeSubscricaoSchema, eventoForaDaJanela, slugDoNome } from "@/lib/subscricoes/evento";

const h = vi.hoisted(() => ({
  segredo: "" as string,
  ator: { id: "11111111-1111-4111-8111-111111111111", email: "dono@example.com", nome: "Dono" } as { id: string; email: string | null; nome: string } | null,
  aplicar: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  env: {
    get SUBSCRICOES_WEBHOOK_SECRET() {
      return h.segredo;
    },
    SUBSCRICOES_WEBHOOK_ATOR_EMAIL: "",
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/subscricoes/servico", () => ({
  resolverAtor: async () => h.ator,
  aplicarEvento: (...args: unknown[]) => h.aplicar(...args),
}));

import { POST } from "@/app/api/v1/webhooks/subscricoes/route";

const SEGREDO = "s".repeat(40);
const agora = () => new Date().toISOString();

function evento(extra: Record<string, unknown> = {}) {
  return {
    event: "subscription.created",
    event_id: "evt_20261102_0001",
    occurred_at: agora(),
    data: {
      plan: "agente_medio",
      organization: { display_name: "Clínica Sol", legal_name: "Clínica Sol, Lda", nuit: "400123456" },
      owner: { email: "Dono@Clinica.co.mz" },
    },
    ...extra,
  };
}

function pedido(corpo: unknown, opts: { assinar?: boolean; segredo?: string; bruto?: string } = {}) {
  const bruto = opts.bruto ?? JSON.stringify(corpo);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.assinar !== false) {
    headers["x-signature"] = createHmac("sha256", opts.segredo ?? SEGREDO).update(bruto).digest("hex");
  }
  return new Request("http://localhost/api/v1/webhooks/subscricoes", { method: "POST", body: bruto, headers }) as never;
}

beforeEach(() => {
  h.segredo = SEGREDO;
  h.ator = { id: "11111111-1111-4111-8111-111111111111", email: "dono@example.com", nome: "Dono" };
  h.aplicar.mockReset();
  h.aplicar.mockResolvedValue({ ok: true, status: 201, corpo: { organization_id: "org-1", created: true } });
});

describe("contrato do evento", () => {
  it("aceita criação, troca de pacote e cancelamento", () => {
    expect(eventoDeSubscricaoSchema.safeParse(evento()).success).toBe(true);
    expect(
      eventoDeSubscricaoSchema.safeParse({
        event: "subscription.plan_changed",
        event_id: "evt_20261102_0002",
        data: { organization_slug: "clinica-sol", plan: "agente_avancado" },
      }).success,
    ).toBe(true);
    expect(
      eventoDeSubscricaoSchema.safeParse({
        event: "subscription.cancelled",
        event_id: "evt_20261102_0003",
        data: { organization_slug: "clinica-sol", reason: "Cliente cancelou o contrato" },
      }).success,
    ).toBe(true);
  });

  it("recusa pacote fora do catálogo, evento desconhecido e cancelamento sem motivo", () => {
    expect(eventoDeSubscricaoSchema.safeParse(evento({ data: { ...evento().data, plan: "gratis" } })).success).toBe(false);
    expect(eventoDeSubscricaoSchema.safeParse({ ...evento(), event: "subscription.deleted" }).success).toBe(false);
    expect(
      eventoDeSubscricaoSchema.safeParse({
        event: "subscription.cancelled",
        event_id: "evt_20261102_0003",
        data: { organization_slug: "clinica-sol", reason: "curto" },
      }).success,
    ).toBe(false);
  });

  it("a chave de idempotência é um uuid estável por event_id", () => {
    const a = chaveDoEvento("evt_1");
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(chaveDoEvento("evt_1")).toBe(a);
    expect(chaveDoEvento("evt_2")).not.toBe(a);
  });

  it("o slug sai do nome sem acento nem símbolo", () => {
    expect(slugDoNome("Clínica Sol & Filhos, Lda")).toBe("clinica-sol-filhos-lda");
    expect(slugDoNome("!!")).toMatch(/^cliente-[0-9a-f]{6}$/);
  });

  it("a janela é de 10 minutos para os dois lados", () => {
    const t = new Date("2026-11-02T10:00:00Z");
    expect(eventoForaDaJanela(undefined, t)).toBe(false);
    expect(eventoForaDaJanela("2026-11-02T09:55:00Z", t)).toBe(false);
    expect(eventoForaDaJanela("2026-11-02T09:40:00Z", t)).toBe(true);
    expect(eventoForaDaJanela("2026-11-02T10:20:00Z", t)).toBe(true);
    expect(eventoForaDaJanela("lixo", t)).toBe(true);
  });
});

describe("teto de tentativas", () => {
  it("o webhook de subscrição entra no limite por IP do proxy", () => {
    expect(superficieInterna("/api/v1/webhooks/subscricoes")).toEqual({ escopo: "subscricoes", limite: 20 });
    expect(superficieInterna("/api/v1/webhooks/in/abc")).toBeNull();
  });
});

describe("POST /api/v1/webhooks/subscricoes", () => {
  it("sem segredo configurado a rota está desligada (404) e nada é executado", async () => {
    h.segredo = "";
    const res = await POST(pedido(evento()));
    expect(res.status).toBe(404);
    expect(h.aplicar).not.toHaveBeenCalled();
  });

  it("sem assinatura ou com assinatura de outro segredo: 401", async () => {
    expect((await POST(pedido(evento(), { assinar: false }))).status).toBe(401);
    expect((await POST(pedido(evento(), { segredo: "x".repeat(40) }))).status).toBe(401);
    expect(h.aplicar).not.toHaveBeenCalled();
  });

  it("assinatura válida mas corpo adulterado depois de assinado: 401", async () => {
    const assinadoPara = JSON.stringify(evento());
    const req = pedido(evento(), { bruto: assinadoPara + " " });
    // a assinatura é do corpo SEM o espaço
    const headers = new Headers((req as unknown as Request).headers);
    headers.set("x-signature", createHmac("sha256", SEGREDO).update(assinadoPara).digest("hex"));
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: assinadoPara + " ", headers }) as never);
    expect(res.status).toBe(401);
  });

  it("JSON inválido e evento fora do contrato: 400", async () => {
    expect((await POST(pedido(null, { bruto: "{nao e json" }))).status).toBe(400);
    expect((await POST(pedido({ event: "subscription.created" }))).status).toBe(400);
    expect(h.aplicar).not.toHaveBeenCalled();
  });

  it("evento antigo (fora da janela): 400", async () => {
    const res = await POST(pedido(evento({ occurred_at: "2020-01-01T00:00:00Z" })));
    expect(res.status).toBe(400);
    expect(h.aplicar).not.toHaveBeenCalled();
  });

  it("instalação sem administrador da plataforma: 500, sem criar nada", async () => {
    h.ator = null;
    const res = await POST(pedido(evento()));
    expect(res.status).toBe(500);
    expect(h.aplicar).not.toHaveBeenCalled();
  });

  it("evento válido assinado: executa uma vez e devolve o status do serviço", async () => {
    const res = await POST(pedido(evento()));
    expect(res.status).toBe(201);
    expect(h.aplicar).toHaveBeenCalledTimes(1);
    const [, ev, ator] = h.aplicar.mock.calls[0]!;
    expect((ev as { event_id: string }).event_id).toBe("evt_20261102_0001");
    expect((ator as { id: string }).id).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("a falha do serviço vira o erro do wrapper com o mesmo status", async () => {
    h.aplicar.mockResolvedValueOnce({ ok: false, status: 409, codigo: "conflict", mensagem: "Slug já existe" });
    const res = await POST(pedido(evento()));
    expect(res.status).toBe(409);
    const corpo = (await res.json()) as { error: { code: string } };
    expect(corpo.error.code).toBe("conflict");
  });
});
