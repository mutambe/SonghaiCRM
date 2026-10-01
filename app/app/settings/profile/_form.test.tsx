import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";
import { traduzir } from "@/lib/i18n/dicionario";
import { ProfileForm } from "./_form";

/**
 * A tela de perfil em espanhol — o que ela MOSTRA e o que ela NÃO pode perder.
 *
 * 1. HIDRATAÇÃO: o form nascia em "pt-MZ" sem receber o idioma salvo —
 *    salvar qualquer campo gravava pt-BR por cima. Sabotagem: remover
 *    `initialLocale` das props reprova o caso 1.
 * 2. VOZ: o espanhol é tuteio neutro ("Escribe", "Elige"). Reintroduzir
 *    voseo ("Escribí") reprova o caso 3.
 */

vi.mock("@/app/actions/settings/updateProfile", () => ({
  updateProfile: vi.fn(async () => ({ ok: true })),
}));

function renderForm(locale: "pt-MZ", initialLocale: "pt-MZ") {
  return render(
    <IdiomaProvider locale={locale}>
      <ProfileForm
        email="dona@empresa.com"
        initialFullName="Dona da Empresa"
        initialAvatarUrl={null}
        initialLocale={initialLocale}
        initialTimezone="Africa/Maputo"
      />
    </IdiomaProvider>,
  );
}

// SonghaiCRM: um idioma só (pt-MZ). O bloco do upstream media o formulário em
// espanhol; este mede o mesmo contrato no idioma que existe aqui.
describe("ProfileForm em português de Moçambique", () => {
  it("hidrata o idioma salvo", () => {
    renderForm("pt-MZ", "pt-MZ");
    expect(screen.getByRole("combobox", { name: "Idioma" })).toHaveTextContent("Português (Moçambique)");
  });

  it("os rótulos vêm em português", () => {
    renderForm("pt-MZ", "pt-MZ");
    expect(screen.getByText("Nome completo")).toBeTruthy();
    expect(screen.getByText("Fuso horário")).toBeTruthy();
  });
});
