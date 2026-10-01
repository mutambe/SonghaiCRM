/**
 * O botão "Cobrar" do negócio (SonghaiCRM, PaySuite).
 *
 * Só cobra o que dá para cobrar: sem valor, ou numa moeda que o PaySuite não
 * cobra (só metical), o botão fica desabilitado e DIZ porquê. Cobrando, chama a
 * rota do negócio e copia o link — o destino é colar no WhatsApp.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { copiar, toastOk, toastErro } = vi.hoisted(() => ({ copiar: vi.fn(), toastOk: vi.fn(), toastErro: vi.fn() }));
vi.mock("@/lib/clipboard", () => ({ copyToClipboard: copiar }));
vi.mock("sonner", () => ({ toast: { success: toastOk, error: toastErro } }));

import { CobrarButton } from "@/components/kanban/CobrarButton";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";

const LEAD = "33333333-3333-4333-8333-333333333333";

function montar(valueCents: number | null, currency: string | null) {
  render(
    <IdiomaProvider locale="pt-MZ">
      <CobrarButton leadId={LEAD} valueCents={valueCents} currency={currency} />
    </IdiomaProvider>,
  );
  return screen.getByTestId("cobrar-negocio");
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  copiar.mockReset();
  toastOk.mockReset();
  toastErro.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("botão Cobrar", () => {
  it("sem valor no negócio: desabilitado, dizendo o que falta", () => {
    const botao = montar(null, "MZN");
    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute("title", expect.stringMatching(/valor/));
  });

  it("negócio em dólar: desabilitado — o PaySuite só cobra em meticais", () => {
    const botao = montar(150000, "USD");
    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute("title", expect.stringMatching(/meticais \(MTn\)/));
  });

  it("negócio em metical: cobra pela rota do negócio e copia o link", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ data: { checkout_url: "https://paysuite.tech/pay/abc" } }), { status: 201 }),
    );
    copiar.mockResolvedValue(true);
    const botao = montar(150000, "MZN");
    expect(botao).toBeEnabled();
    fireEvent.click(botao);
    await waitFor(() => expect(copiar).toHaveBeenCalledWith("https://paysuite.tech/pay/abc"));
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(`/api/v1/leads/${LEAD}/charge`, { method: "POST" });
    expect(toastOk).toHaveBeenCalledWith(expect.stringMatching(/copiado/));
  });

  it("recusa da rota (PaySuite não configurado) vira a mensagem da rota", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "O PaySuite não está configurado. Configure em Integrações › PaySuite." } }), {
        status: 422,
      }),
    );
    fireEvent.click(montar(150000, "MZN"));
    await waitFor(() => expect(toastErro).toHaveBeenCalledWith(expect.stringMatching(/não está configurado/)));
    expect(copiar).not.toHaveBeenCalled();
  });
});
