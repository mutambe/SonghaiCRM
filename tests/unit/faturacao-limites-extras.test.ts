/**
 * SonghaiCRM — o extra contratado sobe o limite do cliente, sozinho.
 *
 * "Acrescentar um número de WhatsApp" tem de ter efeito no limite no mesmo
 * instante em que entra na factura — senão o operador contrata e tem de lembrar
 * de subir o teto à mão, que é exactamente o que se quis evitar.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dataEmMaputo } from "@/lib/billing/calculo";
import { limitesDoTenant } from "@/lib/plans/limiteDoTenant";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const hoje = dataEmMaputo(new Date());
const ontem = dataEmMaputo(new Date(Date.now() - 86_400_000 * 2));
const ORG = "22222222-2222-4222-8222-222222222222";

function banco(limits: Record<string, unknown>, extras: unknown[] | "erro") {
  return {
    from(tabela: string) {
      if (tabela === "subscription_items") {
        const b: Record<string, unknown> = {
          select: () => b,
          eq: () => (extras === "erro" ? Promise.reject(new Error("banco fora")) : Promise.resolve({ data: extras, error: null })),
        };
        return b;
      }
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        is: () => b,
        maybeSingle: async () => ({
          data: { plan: { slug: "agente_simples", display_name: "Agente Simples", limits } },
          error: null,
        }),
      };
      return b;
    },
  };
}

const extraWhatsapp = (sobre: Record<string, unknown> = {}) => ({
  quantity: 1, adds_whatsapp_connections: 1, adds_users: 0, started_on: ontem, ended_on: null, ...sobre,
});

beforeEach(() => vi.clearAllMocks());

describe("limites do cliente = pacote + extras", () => {
  it("um número de WhatsApp extra: o teto do Simples passa de 1 para 2", async () => {
    vi.mocked(createAdminClient).mockReturnValue(banco({ max_users: 20, max_whatsapp_connections: 1 }, [extraWhatsapp()]) as never);
    const l = await limitesDoTenant(ORG);
    expect(l?.maxWhatsappConnections).toBe(2);
    expect(l?.maxUsers).toBe(20);
  });

  it("dois extras de quantidades diferentes somam", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      banco({ max_users: 20, max_whatsapp_connections: 1 }, [extraWhatsapp({ quantity: 2 }), extraWhatsapp()]) as never,
    );
    expect((await limitesDoTenant(ORG))?.maxWhatsappConnections).toBe(4);
  });

  it("o extra que acabou deixa de contar: o teto desce sozinho", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      banco({ max_whatsapp_connections: 1 }, [extraWhatsapp({ ended_on: ontem })]) as never,
    );
    expect((await limitesDoTenant(ORG))?.maxWhatsappConnections).toBe(1);
  });

  it("o que ainda não começou não conta", async () => {
    const amanha = dataEmMaputo(new Date(Date.now() + 86_400_000 * 3));
    vi.mocked(createAdminClient).mockReturnValue(
      banco({ max_whatsapp_connections: 1 }, [extraWhatsapp({ started_on: amanha })]) as never,
    );
    expect((await limitesDoTenant(ORG))?.maxWhatsappConnections).toBe(1);
  });

  it("extra de utilizadores sobe o limite de utilizadores", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      banco({ max_users: 20, max_whatsapp_connections: 1 }, [
        { quantity: 5, adds_whatsapp_connections: 0, adds_users: 1, started_on: ontem, ended_on: null },
      ]) as never,
    );
    const l = await limitesDoTenant(ORG);
    expect(l?.maxUsers).toBe(25);
    expect(l?.maxWhatsappConnections).toBe(1);
  });

  it("pacote sem teto (Enterprise) continua sem teto", async () => {
    vi.mocked(createAdminClient).mockReturnValue(banco({}, [extraWhatsapp()]) as never);
    const l = await limitesDoTenant(ORG);
    expect(l?.maxWhatsappConnections).toBe(Infinity);
    expect(l?.maxUsers).toBe(Infinity);
  });

  it("falha ao ler os extras: vale só o pacote, nunca bloqueia a mais", async () => {
    vi.mocked(createAdminClient).mockReturnValue(banco({ max_whatsapp_connections: 1 }, "erro") as never);
    expect((await limitesDoTenant(ORG))?.maxWhatsappConnections).toBe(1);
  });
});
