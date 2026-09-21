/**
 * Vocabulário da integração de agenda externa — trecho MÍNIMO para a Fase 1
 * (conectar/listar/desconectar). Adaptado do módulo de Agenda do upstream
 * DeskcommCRM, que tem um vocabulário bem mais amplo (sincronização
 * incremental, eventos externos, conflitos) — fora do escopo desta fase.
 */

/** Quem fornece a agenda conectada. Só um por enquanto — a coluna é aberta
 *  (`text` + CHECK, nunca enum) para o dia em que outro provedor entrar. */
export const PROVEDORES_DE_AGENDA = ["google_calendar"] as const;
export type ProvedorDeAgenda = (typeof PROVEDORES_DE_AGENDA)[number];
export const PROVEDOR_GOOGLE: ProvedorDeAgenda = "google_calendar";

/**
 * Vocabulário idêntico ao de `tenant_integrations.status` — mesma pergunta,
 * mesma palavra, por doutrina deste repo.
 */
export const SITUACOES_DA_CONEXAO = [
  "connecting",
  "healthy",
  "token_expired",
  "scope_missing",
  "disconnected",
  "rate_limited",
  "error",
] as const;
export type SituacaoDaConexao = (typeof SITUACOES_DA_CONEXAO)[number];

export const ROTULO_DA_SITUACAO_DA_CONEXAO: Record<SituacaoDaConexao, string> = {
  connecting: "Conectando",
  healthy: "Conectada",
  token_expired: "Reconecte sua agenda",
  scope_missing: "Falta permissão de calendário",
  disconnected: "Desconectada",
  rate_limited: "O Google pediu para esperar",
  error: "Erro na conexão",
};
