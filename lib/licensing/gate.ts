/**
 * Decisão de bloqueio do gate de licenciamento. Puro — sem I/O — para ser
 * testável sem banco nem rede; `middleware.ts` (Task 11) só monta o
 * `{ token, fetchedAt }` a partir do banco e chama isto.
 *
 * Duas checagens independentes, as DUAS precisam passar:
 *  1. O token (assinado, não forjável por edição de banco) diz `active`/
 *     `trial` E `current_period_end` ainda não passou.
 *  2. O último fetch bem-sucedido da central foi há menos de
 *     `GRACE_PERIOD_MS` — cobre queda temporária do serviço central sem
 *     penalizar quem paga; mas evita que uma instalação fique parada para
 *     sempre num token cacheado sem nunca revalidar.
 */
import { verifyLicenseToken } from "./token";

export const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

export interface CachedLicenseState {
  token: string | null;
  fetchedAt: Date | null;
}

export interface GateDecision {
  bloqueado: boolean;
  motivo: "sem_licenca" | "sem_contato" | "assinatura_vencida" | null;
}

export function avaliarAcesso(cached: CachedLicenseState, now: Date, publicKeyPem: string): GateDecision {
  if (!cached.token || !cached.fetchedAt) {
    return { bloqueado: true, motivo: "sem_licenca" };
  }

  if (now.getTime() - cached.fetchedAt.getTime() > GRACE_PERIOD_MS) {
    return { bloqueado: true, motivo: "sem_contato" };
  }

  const payload = verifyLicenseToken(cached.token, publicKeyPem);
  if (!payload) {
    return { bloqueado: true, motivo: "sem_licenca" };
  }

  if (payload.status === "revoked" || payload.status === "past_due") {
    return { bloqueado: true, motivo: "assinatura_vencida" };
  }

  if (new Date(payload.current_period_end).getTime() < now.getTime()) {
    return { bloqueado: true, motivo: "assinatura_vencida" };
  }

  return { bloqueado: false, motivo: null };
}
