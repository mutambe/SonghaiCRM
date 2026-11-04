/**
 * SonghaiCRM — a lista de testes «fora da oferta» (tests/songhai-fora-da-oferta.ts)
 * é o único sítio onde um teste do upstream deixa de correr. Para não virar o
 * lugar onde se escondem falhas: todo ficheiro listado existe, tem motivo escrito,
 * não se repete, e não é uma cerca estrutural nem um teste de base de dados.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { FORA_DA_OFERTA } from "../songhai-fora-da-oferta";

const RAIZ = path.resolve(__dirname, "../..");

describe("testes fora da oferta", () => {
  it("todo ficheiro listado existe", () => {
    expect(FORA_DA_OFERTA.filter((f) => !fs.existsSync(path.join(RAIZ, f.arquivo))).map((f) => f.arquivo)).toEqual([]);
  });

  it("todo ficheiro tem um motivo escrito", () => {
    expect(FORA_DA_OFERTA.filter((f) => f.motivo.trim().length < 20).map((f) => f.arquivo)).toEqual([]);
  });

  it("nenhum ficheiro aparece duas vezes", () => {
    const vistos = new Set<string>();
    const repetidos = FORA_DA_OFERTA.map((f) => f.arquivo).filter((a) => (vistos.has(a) ? true : (vistos.add(a), false)));
    expect(repetidos).toEqual([]);
  });

  it("nunca specs e2e; invariantes de banco só com o motivo da cobrança do Brasil", () => {
    expect(FORA_DA_OFERTA.filter((f) => /^tests\/e2e\//.test(f.arquivo)).map((f) => f.arquivo)).toEqual([]);
    const invariantes = FORA_DA_OFERTA.filter((f) => /^tests\/invariants\//.test(f.arquivo));
    expect(invariantes.filter((f) => !/cobranca_planos/.test(f.motivo)).map((f) => f.arquivo)).toEqual([]);
  });
});
