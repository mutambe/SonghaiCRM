/**
 * LOCALIZAÇÃO QUE A EQUIPA ENVIA — SonghaiCRM (ideia trazida do OpenWA).
 *
 * `type: "location"` já existia no vocabulário de envio, mas saía como texto:
 * nenhum canal recebia as coordenadas. Agora o handler normaliza a entrada
 * aqui e o envelope leva o pino (`OutboundEnvelope.location`).
 *
 * A linha gravada fica no MESMO formato da localização recebida
 * (`metadata.location` + corpo com o link), então a bolha, a prévia da lista
 * e o agente leem as duas direções pelas mesmas funções de `./localizacao`.
 */
import type { SendMessageInput } from "@/lib/schemas";

import { corpoDaLocalizacao, lerLocalizacao, type Localizacao } from "./localizacao";

export type LocalizacaoDeSaida =
  | { ok: true; input: SendMessageInput; localizacao: Localizacao }
  | { ok: false };

/** Só para `type: "location"`; quem chama decide o que fazer com `ok: false`. */
export function normalizarLocalizacaoDeSaida(input: SendMessageInput): LocalizacaoDeSaida {
  const loc = lerLocalizacao(input.metadata?.location);
  if (!loc) return { ok: false };
  return {
    ok: true,
    localizacao: loc,
    input: {
      ...input,
      body: input.body?.trim() || corpoDaLocalizacao(loc),
      metadata: {
        ...(input.metadata ?? {}),
        location: {
          latitude: loc.latitude,
          longitude: loc.longitude,
          ...(loc.nome ? { name: loc.nome } : {}),
          ...(loc.endereco ? { address: loc.endereco } : {}),
        },
      },
    },
  };
}

/**
 * Lê "-25.9692, 32.5732", "-25.9692 32.5732" ou um link de mapa com as
 * coordenadas (`?q=lat,lng`, `@lat,lng`, `ll=lat,lng`). É o que a equipa tem à
 * mão: copia o ponto do Google Maps. Link encurtado (`maps.app.goo.gl`) não
 * traz as coordenadas no texto, e por isso dá `null`.
 */
export function coordenadasDoTexto(texto: string): { latitude: number; longitude: number } | null {
  const t = decodeURIComponent(texto.trim());
  const padroes = [
    /@(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/,
    /[?&](?:q|query|ll|destination)=(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/,
    /^(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/,
  ];
  for (const p of padroes) {
    const m = p.exec(t);
    if (!m) continue;
    const loc = lerLocalizacao({ latitude: Number(m[1]), longitude: Number(m[2]) });
    if (loc) return { latitude: loc.latitude, longitude: loc.longitude };
  }
  return null;
}
