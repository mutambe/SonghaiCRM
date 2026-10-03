/**
 * SonghaiCRM — o upload avisa quando o logo NÃO tem fundo transparente.
 *
 * Caso real (2026-10-03): um PNG com o fundo pintado aparecia como um retângulo
 * escuro na barra lateral, e nada no ecrã dizia porquê. Aqui se mede:
 *   1. a regra pura (`haPixelTransparente`) nos dois sentidos;
 *   2. JPEG responde `false` sem decodificar (não tem canal alfa);
 *   3. o componente avisa quando a medida é `false`, e cala com `true` ou `null`
 *      (sem medida não há aviso — avisar errado ensina a ignorar avisos).
 */
import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

const medida = vi.hoisted(() => ({ valor: null as boolean | null }));
vi.mock("@/lib/branding/transparencia-do-logo", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/branding/transparencia-do-logo")>();
  return { ...original, logoTemTransparencia: vi.fn(async () => medida.valor) };
});

import { toast } from "sonner";

import { CampoDeLogo } from "@/components/branding/CampoDeLogo";
import { haPixelTransparente } from "@/lib/branding/transparencia-do-logo";

const { logoTemTransparencia: real } = await vi.importActual<typeof import("@/lib/branding/transparencia-do-logo")>(
  "@/lib/branding/transparencia-do-logo",
);

describe("a regra", () => {
  it("um pixel com alfa < 255 basta", () => {
    expect(haPixelTransparente([10, 20, 30, 255, 0, 0, 0, 0])).toBe(true);
    expect(haPixelTransparente([10, 20, 30, 255, 0, 0, 0, 254])).toBe(true);
  });

  it("tudo opaco é sem transparência (o PNG de fundo pintado)", () => {
    expect(haPixelTransparente([33, 27, 21, 255, 33, 27, 21, 255])).toBe(false);
  });

  it("JPEG é sem transparência, sem decodificar", async () => {
    expect(await real(new File([new Uint8Array([0xff, 0xd8, 0xff])], "l.jpg", { type: "image/jpeg" }))).toBe(false);
  });

  it("sem canvas no ambiente não há medida (null), e não um 'não' inventado", async () => {
    expect(await real(new File([new Uint8Array([0x89, 0x50])], "l.png", { type: "image/png" }))).toBeNull();
  });
});

describe("o ecrã de marca", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: { logo_url: "https://exemplo.invalido/logo.png" } }) });
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(toast.warning).mockReset();
    vi.mocked(toast.success).mockReset();
  });

  async function enviarUmLogo() {
    render(
      <CampoDeLogo escopo="instalacao" logoDaCamada={{ url: null }} logoHerdado={null} origemDoHerdado="do sistema" nomeEmVigor="SonghaiCRM" />,
    );
    const input = document.querySelector("#logo-instalacao") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(10)], "logo.png", { type: "image/png" })] } });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  }

  it("⭐ logo sem transparência: avisa e diz o que fazer", async () => {
    medida.valor = false;
    await enviarUmLogo();
    await waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));
    expect(String(vi.mocked(toast.warning).mock.calls[0]![0])).toMatch(/fundo transparente/);
  });

  it("controle: logo transparente não avisa", async () => {
    medida.valor = true;
    await enviarUmLogo();
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("controle: sem medida não avisa", async () => {
    medida.valor = null;
    await enviarUmLogo();
    expect(toast.warning).not.toHaveBeenCalled();
  });
});
