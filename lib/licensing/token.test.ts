import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { signLicenseToken, verifyLicenseToken } from "./token";

function gerarPar() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

describe("licensing/token", () => {
  it("assina e verifica um token válido", () => {
    const { publicPem, privatePem } = gerarPar();
    const token = signLicenseToken(
      { license_id: "lic-1", status: "active", current_period_end: "2026-12-01T00:00:00.000Z" },
      privatePem,
    );
    const payload = verifyLicenseToken(token, publicPem);
    expect(payload).not.toBeNull();
    expect(payload?.license_id).toBe("lic-1");
    expect(payload?.status).toBe("active");
  });

  it("rejeita token com payload adulterado (troca de status sem re-assinar)", () => {
    const { publicPem, privatePem } = gerarPar();
    const token = signLicenseToken(
      { license_id: "lic-1", status: "past_due", current_period_end: "2026-01-01T00:00:00.000Z" },
      privatePem,
    );
    const [body, sig] = token.split(".");
    const payloadAdulterado = JSON.parse(Buffer.from(body ?? "", "base64url").toString("utf8"));
    payloadAdulterado.status = "active";
    const bodyAdulterado = Buffer.from(JSON.stringify(payloadAdulterado)).toString("base64url");
    const tokenAdulterado = `${bodyAdulterado}.${sig}`;

    expect(verifyLicenseToken(tokenAdulterado, publicPem)).toBeNull();
  });

  it("rejeita token verificado com a chave pública errada", () => {
    const par1 = gerarPar();
    const par2 = gerarPar();
    const token = signLicenseToken(
      { license_id: "lic-1", status: "active", current_period_end: "2026-12-01T00:00:00.000Z" },
      par1.privatePem,
    );
    expect(verifyLicenseToken(token, par2.publicPem)).toBeNull();
  });

  it("rejeita string mal formada sem lançar", () => {
    const { publicPem } = gerarPar();
    expect(verifyLicenseToken("lixo-sem-ponto", publicPem)).toBeNull();
    expect(verifyLicenseToken("", publicPem)).toBeNull();
  });

  it("assina com a chave privada em base64 numa linha só (formato recomendado pro .env)", () => {
    const { publicPem, privatePem } = gerarPar();
    const privateB64 = Buffer.from(privatePem, "utf8").toString("base64");
    const token = signLicenseToken(
      { license_id: "lic-1", status: "active", current_period_end: "2026-12-01T00:00:00.000Z" },
      privateB64,
    );
    const payload = verifyLicenseToken(token, publicPem);
    expect(payload?.license_id).toBe("lic-1");
  });

  it("verifica com a chave pública em base64 numa linha só (LICENSING_PUBLIC_KEY_PEM_TEST_OVERRIDE)", () => {
    const { publicPem, privatePem } = gerarPar();
    const publicB64 = Buffer.from(publicPem, "utf8").toString("base64");
    const token = signLicenseToken(
      { license_id: "lic-1", status: "active", current_period_end: "2026-12-01T00:00:00.000Z" },
      privatePem,
    );
    const payload = verifyLicenseToken(token, publicB64);
    expect(payload?.license_id).toBe("lic-1");
  });
});
