import type { Idioma } from "@/lib/i18n/idiomas";

import { FUSO_PADRAO } from "@/lib/tempo/fusos";

export { FUSO_PADRAO };

/**
 * Formatador de data no fuso da EMPRESA, não no do servidor (UTC numa VPS) nem
 * no do navegador: o painel e o recado têm de dizer o mesmo dia. Fuso ilegível
 * gravado na org cai no padrão (RangeError do Intl).
 */
export function formatadorDeData(idioma: Idioma, fuso: string | null, opcoes: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(idioma, { ...opcoes, timeZone: fuso ?? FUSO_PADRAO });
  } catch {
    return new Intl.DateTimeFormat(idioma, { ...opcoes, timeZone: FUSO_PADRAO });
  }
}
