/**
 * Defaults CONSERVADORES do motor anti-ban (F2-11) — a FONTE ÚNICA dos números
 * de pacing do daemon (blueprint 5.2: números anti-ban são fonte única e
 * inconsistente → knobs, nunca constantes). `scripts/lint-pacing.ts` reprova
 * literal de pacing em qualquer outro arquivo de daemon/src.
 *
 * Override por número/sessão: linha em `channel_knobs` (0010) — coluna NULL cai
 * aqui. O CAP DIÁRIO ABSOLUTO não mora aqui nem em channel_knobs: a fonte única
 * é `channel_sessions.daily_message_limit` (regra dura nº 3) — mesmo banco agora,
 * a cadeia de envio lê por query direta e injeta em `decidePacing` (`crmDailyLimit`).
 */

/** Degrau de warm-up: a partir de `minAgeDays` de idade do número vale `cap` envios/dia; `cap: null` = formado (sem cap de warm-up — resta só o limite do CRM). */
export interface WarmupStep {
  minAgeDays: number;
  cap: number | null;
}

export interface PacingKnobs {
  /** Intervalo mínimo entre envios do MESMO número (ms). */
  throttleMs: number;
  /** Teto do jitter randômico somado ao throttle e ao next_allowed_at (ms) — intervalo fixo é assinatura de bot. */
  jitterMaxMs: number;
  /** Janela horária de envio [start, end) na hora local do tenant. */
  windowStartHour: number;
  windowEndHour: number;
  /** Domingo é evitado por default. */
  allowSunday: boolean;
  /** IANA timezone do tenant — a janela é avaliada NELA. */
  timezone: string;
  /** Degraus de warm-up ordenados por minAgeDays crescente (o primeiro cobre idade 0). */
  warmupDailyCaps: WarmupStep[];
}

/**
 * Limites de SANIDADE da edição de knobs no Console (FU-14) — validação de entrada do
 * operador, não defaults de comportamento. Moram aqui porque a doutrina proíbe número de
 * pacing fora deste módulo (scripts/lint-pacing.ts); o Console os importa em vez de
 * cravar literais.
 */
export const KNOB_BOUNDS = {
  /** teto de intervalo/jitter aceito na UI (ms). */
  intervalMaxMs: 600_000,
  /** maior hora aceita como INÍCIO de janela (fim vai até 24). */
  hourLastStart: 23,
  /** fim de janela é exclusivo e pode chegar à meia-noite seguinte. */
  hourEnd: 24,
} as const;

export const PACING_DEFAULTS: PacingKnobs = {
  throttleMs: 1200, // 1 msg / 1,2s
  jitterMaxMs: 800,
  windowStartHour: 6, // janela 6h-23h
  windowEndHour: 23,
  // Aberto por padrão (2026-09-06, decisão do dono do produto): existem
  // modelos de negócio (e-commerce, delivery, imobiliária de plantão) em que
  // domingo é dia normal de atendimento. Continua sendo CORTESIA, não
  // anti-ban (invariante 3 de docs/doctrine/restricao-de-canal.md) — quem
  // quiser fechar domingo para um número específico desliga o interruptor
  // "Enviar aos domingos" em Conexões → proteção de envio (AntiBanSheet.tsx).
  allowSunday: true,
  timezone: 'Africa/Maputo',
  // Número sem linha em channel_knobs é tratado como idade 0 (o degrau mais
  // conservador) até alguém registrar number_activated_at.
  warmupDailyCaps: [
    // Piso 20→50 (2026-09-06, decisão do dono do produto): o degrau anterior
    // travava número novo depois de um único atendimento com idas e vindas —
    // medido em produção, uma conversa comum de qualificação consumiu as 20
    // mensagens sozinha e derrubou a IA para TODO o número pelo resto do dia
    // (nenhum cliente novo recebia resposta, não só o que esgotou o cap).
    { minAgeDays: 0, cap: 50 },
    { minAgeDays: 4, cap: 50 },
    { minAgeDays: 8, cap: 100 },
    { minAgeDays: 15, cap: 200 },
    { minAgeDays: 31, cap: null },
  ],
};
