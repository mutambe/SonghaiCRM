/**
 * Extrai o id externo da resposta de envio / do payload de webhook da
 * Evolution API v2. Ao contrário do WAHA (shape varia por engine/versão), a
 * Evolution API sempre devolve `key.id` — sem os múltiplos formatos que
 * `parseWahaMessageId` precisa tratar.
 */
export function parseEvolutionMessageId(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as { key?: { id?: unknown } };
  if (typeof r.key === "object" && r.key !== null && typeof r.key.id === "string") {
    return r.key.id;
  }
  return null;
}
