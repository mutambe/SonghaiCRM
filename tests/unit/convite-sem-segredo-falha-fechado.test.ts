/**
 * Convite sem segredo falha FECHADO (SonghaiCRM).
 *
 * O upstream resolve o segredo do convite com `?? "dev-fallback"`. O repo é
 * público, e o aceite confia só na assinatura: sem segredo configurado, qualquer
 * um assina um convite de ADMIN para a organização que quiser. E `??` deixava
 * passar a string vazia (`INVITE_TOKEN_SECRET=` no `.env`).
 *
 * Cada caso aqui forja o convite como um atacante faria, com a chave que ele
 * teria, e prova que o produto recusa — mais o controle com o segredo certo.
 */
import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { signInviteToken, verifyInviteToken, type InvitePayload } from "@/lib/auth/invite-token";

const CONVITE_DE_ADMIN: InvitePayload = {
  invite_id: "11111111-1111-4111-8111-111111111111",
  email: "atacante@exemplo.co.mz",
  organization_id: "22222222-2222-4222-8222-222222222222",
  role: "admin",
  exp: Math.floor(Date.now() / 1000) + 3600,
};

/** Assina como o atacante: com a chave que ELE escolhe. */
function forjar(chave: string): string {
  const body = Buffer.from(JSON.stringify(CONVITE_DE_ADMIN), "utf8").toString("base64url");
  const sig = createHmac("sha256", chave).update(body).digest("base64url");
  return `${body}.${sig}`;
}

const SALVO = { INVITE_TOKEN_SECRET: process.env.INVITE_TOKEN_SECRET, INTERNAL_SECRET: process.env.INTERNAL_SECRET };

function semSegredo() {
  delete process.env.INVITE_TOKEN_SECRET;
  delete process.env.INTERNAL_SECRET;
}

beforeEach(() => {
  process.env.INTERNAL_SECRET = "segredo-real-da-instalacao";
  delete process.env.INVITE_TOKEN_SECRET;
});

afterEach(() => {
  for (const [chave, valor] of Object.entries(SALVO)) {
    if (valor === undefined) delete process.env[chave];
    else process.env[chave] = valor;
  }
});

describe("convite sem segredo", () => {
  it("instalação sem segredo: o convite forjado com o literal do upstream é recusado", () => {
    semSegredo();
    expect(verifyInviteToken(forjar("dev-fallback"))).toBeNull();
  });

  it("segredo VAZIO no .env conta como ausente: assinatura com chave vazia é recusada", () => {
    process.env.INVITE_TOKEN_SECRET = "";
    process.env.INTERNAL_SECRET = "";
    expect(verifyInviteToken(forjar(""))).toBeNull();
  });

  it("emitir sem segredo lança — nunca sai um convite assinado com chave conhecida", () => {
    semSegredo();
    expect(() => signInviteToken(CONVITE_DE_ADMIN)).toThrow(/invite_secret_missing/);
  });

  it("com o segredo da instalação, o literal do upstream continua sem valer", () => {
    expect(verifyInviteToken(forjar("dev-fallback"))).toBeNull();
  });

  it("controle: o convite emitido pela instalação é aceito", () => {
    const token = signInviteToken(CONVITE_DE_ADMIN);
    expect(verifyInviteToken(token)).toMatchObject({ role: "admin", email: CONVITE_DE_ADMIN.email });
  });
});
