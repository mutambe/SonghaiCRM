import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { signLicenseToken } from "./token";
import { avaliarAcesso, GRACE_PERIOD_MS } from "./gate";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

function token(status: "trial" | "active" | "past_due" | "revoked", periodEndIso: string) {
  return signLicenseToken({ license_id: "lic-1", status, current_period_end: periodEndIso }, privatePem);
}

describe("licensing/gate", () => {
  const now = new Date("2026-09-04T12:00:00.000Z");

  it("bloqueia quando não há token cacheado (nunca contactou a central)", () => {
    const r = avaliarAcesso({ token: null, fetchedAt: null }, now, publicPem);
    expect(r).toEqual({ bloqueado: true, motivo: "sem_licenca" });
  });

  it("libera com token 'trial' dentro do período", () => {
    const t = token("trial", "2026-09-10T00:00:00.000Z");
    const r = avaliarAcesso({ token: t, fetchedAt: now }, now, publicPem);
    expect(r).toEqual({ bloqueado: false, motivo: null });
  });

  it("libera com token 'active' dentro do período", () => {
    const t = token("active", "2026-10-01T00:00:00.000Z");
    const r = avaliarAcesso({ token: t, fetchedAt: now }, now, publicPem);
    expect(r).toEqual({ bloqueado: false, motivo: null });
  });

  it("bloqueia com token 'past_due'", () => {
    const t = token("past_due", "2026-08-01T00:00:00.000Z");
    const r = avaliarAcesso({ token: t, fetchedAt: now }, now, publicPem);
    expect(r).toEqual({ bloqueado: true, motivo: "assinatura_vencida" });
  });

  it("bloqueia com token 'revoked' mesmo com current_period_end no futuro", () => {
    const t = token("revoked", "2027-01-01T00:00:00.000Z");
    const r = avaliarAcesso({ token: t, fetchedAt: now }, now, publicPem);
    expect(r).toEqual({ bloqueado: true, motivo: "assinatura_vencida" });
  });

  it("bloqueia com token 'active' cujo current_period_end já passou (token velho, cache não renovado)", () => {
    const t = token("active", "2026-09-01T00:00:00.000Z"); // antes de `now`
    const r = avaliarAcesso({ token: t, fetchedAt: now }, now, publicPem);
    expect(r).toEqual({ bloqueado: true, motivo: "assinatura_vencida" });
  });

  it("bloqueia com token adulterado (assinatura não bate)", () => {
    const t = token("active", "2026-10-01T00:00:00.000Z");
    const adulterado = t.slice(0, -4) + "xxxx";
    const r = avaliarAcesso({ token: adulterado, fetchedAt: now }, now, publicPem);
    expect(r).toEqual({ bloqueado: true, motivo: "sem_licenca" });
  });

  it("bloqueia por falta de contacto quando o último fetch passou do grace period, mesmo com token 'active'", () => {
    const t = token("active", "2027-01-01T00:00:00.000Z"); // ainda válido
    const fetchedAt = new Date(now.getTime() - GRACE_PERIOD_MS - 1000);
    const r = avaliarAcesso({ token: t, fetchedAt }, now, publicPem);
    expect(r).toEqual({ bloqueado: true, motivo: "sem_contato" });
  });

  it("libera quando o último fetch está dentro do grace period, mesmo perto do limite", () => {
    const t = token("active", "2027-01-01T00:00:00.000Z");
    const fetchedAt = new Date(now.getTime() - GRACE_PERIOD_MS + 1000);
    const r = avaliarAcesso({ token: t, fetchedAt }, now, publicPem);
    expect(r).toEqual({ bloqueado: false, motivo: null });
  });
});
