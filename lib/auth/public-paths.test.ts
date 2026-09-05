import { describe, expect, it } from "vitest";
import { isPublicPath } from "./public-paths";

describe("isPublicPath — licenciamento self-host (PaySuite)", () => {
  it("libera /verify, /renew e o webhook — chamadas de servidor-a-servidor, sem cookie", () => {
    expect(isPublicPath("/api/v1/licensing/verify")).toBe(true);
    expect(isPublicPath("/api/v1/licensing/renew")).toBe(true);
    expect(isPublicPath("/api/v1/licensing/webhooks/paysuite")).toBe(true);
  });

  it("mantém as rotas administrativas atrás de sessão — só a tela /admin/licensing usa", () => {
    expect(isPublicPath("/api/v1/licensing/admin")).toBe(false);
    expect(isPublicPath("/api/v1/licensing/admin/paysuite-credentials")).toBe(false);
  });

  it("não libera por acidente um path parecido com prefixo errado", () => {
    expect(isPublicPath("/api/v1/licensing/verify/extra")).toBe(false);
    expect(isPublicPath("/api/v1/licensing/renewx")).toBe(false);
  });
});
