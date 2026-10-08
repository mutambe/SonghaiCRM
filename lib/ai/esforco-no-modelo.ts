/**
 * O esforço aplicado ao modelo (SonghaiCRM, migration 9006). Separado de
 * `./esforco.ts` porque aquele módulo é puro e a tela o importa; este puxa o
 * SDK `ai` e só roda no servidor.
 */
import { defaultSettingsMiddleware, wrapLanguageModel, type LanguageModel } from "ai";

import type { Esforco } from "./esforco";

/**
 * Embrulha o modelo para que TODA chamada leve o esforço, por quem quer que
 * chame (`generateText`, `generateObject`, `streamText`). O middleware mescla
 * em profundidade: o `cacheControl` que o motor já manda em `providerOptions`
 * continua lá.
 */
export function comEsforco(modelo: LanguageModel, esforco: Esforco | null): LanguageModel {
  if (esforco === null || typeof modelo === "string") return modelo;
  return wrapLanguageModel({
    model: modelo,
    middleware: defaultSettingsMiddleware({
      settings: { providerOptions: { anthropic: { effort: esforco } } },
    }),
  });
}

/**
 * O provedor de um modelo, para decidir o que ele aceita.
 *
 * Modelo já instanciado: o identificador que o próprio SDK carrega
 * (`anthropic.messages`, `openai.responses`, …). Modelo em STRING — o caminho do
 * gateway (`resolveLanguageModel`) —, que não carrega nada: o provedor é o
 * prefixo do id (`anthropic/claude-sonnet-5` → `anthropic`) e, sem prefixo, um
 * id `claude-…` é da Anthropic. Devolver `null` aqui fazia `aceitaAmostragem("")`
 * responder «sim» e a `temperature: 0` voltar para um modelo que a recusa.
 * `null` só quando nada diz de quem é o modelo.
 */
export function provedorDoModelo(modelo: LanguageModel, modelId?: string | null): string | null {
  if (typeof modelo !== "string") {
    const bruto = (modelo as { provider?: unknown }).provider;
    if (typeof bruto === "string" && bruto !== "") return bruto.split(".")[0] ?? null;
  }
  const id = typeof modelo === "string" ? modelo : (modelId ?? "");
  const barra = id.indexOf("/");
  if (barra > 0) return id.slice(0, barra);
  return id.startsWith("claude-") ? "anthropic" : null;
}
