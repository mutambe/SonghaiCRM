/**
 * TELEFONE ESCRITO POR GENTE → E.164, ASSUMINDO MOÇAMBIQUE QUANDO NÃO HÁ INDICATIVO.
 *
 * SonghaiCRM. O upstream lê planilha e formulário de captação com
 * `normalizePhoneBR` (`lib/webhooks/inbound.ts`): 10–11 dígitos sem `+` viram
 * `+55…`. Numa instalação moçambicana isso gravaria o número de outra pessoa,
 * noutro país — o lead que digitou "84 123 4567" no site nascia brasileiro.
 *
 * A regra daqui:
 *
 *   - `+` com 8 a 15 dígitos (internacional, escrito pela pessoa) → como está;
 *   - `258` + celular (8[2-7] + 7 dígitos) ou fixo (2[1-9] + 6)   → `+258…`;
 *   - celular de 9 dígitos ou fixo de 8, sem indicativo            → `+258…`;
 *   - qualquer outra coisa                                         → `null`.
 *
 * Recusar é melhor do que adivinhar outro país: `null` vira "telefone inválido"
 * na linha da planilha e, na captação, o lead entra pelo e-mail.
 */
const LOCAL_MZ = /^(8[2-7]\d{7}|2[1-9]\d{6})$/;

export function normalizarTelefoneLocal(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const digitos = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+")) {
    return /^\d{8,15}$/.test(digitos) ? `+${digitos}` : null;
  }
  const local = digitos.startsWith("258") ? digitos.slice(3) : digitos;
  return LOCAL_MZ.test(local) ? `+258${local}` : null;
}
