-- 0175 — agent_inbox_items ganha 'message_send_blocked'
--
-- Causa raiz medida em produção (2026-09-05): um número novo bateu o cap de
-- warm-up (`lib/agent-engine/pacing/engine.ts`, código `warmup_cap`) no meio
-- de UMA conversa de qualificação e ficou sem enviar nada — nem a essa
-- conversa, nem a NENHUMA outra do mesmo número — pelo resto do dia. O gate
-- devolve o veto ao MODELO como erro de ensino (doutrina F2-13), mas depender
-- só da memória do modelo para tentar de novo é o que falhou: depois de UM
-- veto, o modelo parou de tentar reenviar em turnos seguintes — inclusive no
-- dia seguinte, já com o cap resetado —, e três mensagens do cliente
-- ('Estou à espera da resposta', 'Olá', 'Olá') ficaram sem resposta por ~20h,
-- sem NENHUM aviso na Central. Ninguém sabia que havia algo para resolver.
--
-- Este kind é o que `lib/agent-engine/agent/inbound-turn.ts` grava quando um
-- turno termina com veto de pacing (`outside_window`/`warmup_cap`/`daily_cap`)
-- e nenhum envio bem-sucedido no mesmo turno — SEMPRE em paralelo ao retry
-- automático via `applyScheduleFollowup` (o sistema agenda o retorno, nunca
-- confia só no modelo lembrar). `warn`, não `critical`: não é falha, é a
-- proteção anti-ban funcionando — mas alguém precisa saber que está segurando.
--
-- ESTE É O BLOCO ÚNICO desta constraint (mesma regra da 0139/0159/0166,
-- vigiado por tests/unit/baseline-constraint-reconstruida.test.ts): a lista
-- abaixo é a lista completa da 0166 (a última a reconstruir a constraint) mais
-- o valor novo, para que tests/unit/kind-check-migration-x-baseline.test.ts
-- continue verde.
alter table public.agent_inbox_items
  drop constraint if exists agent_inbox_items_kind_check;

alter table public.agent_inbox_items
  add constraint agent_inbox_items_kind_check check (kind in (
    'qr_rescan',
    'job_dead',
    'event_dead',
    'budget_exceeded',
    'handoff',
    'promotion_review',
    'judge_unaligned',
    'followup_dead',
    'snooze_expired',
    'next_action_ambiguous',
    'risk_backlog_seeded',
    'reactivation_expired',
    'capabilities_missing',
    'message_send_stuck',
    'midia_nao_lida',
    'channel_template_review',
    'channel_number_alert',
    'promise_unfulfilled',
    'contact_proposal_expired',
    'budget_warning',
    'appointment_outcome_pending',
    -- (migration 0175) Veto de pacing (anti-ban) sem envio bem-sucedido no
    -- turno. Entra no fim da lista, antes de 'other', mesma convenção das
    -- entradas acima.
    'message_send_blocked',
    'other'
  ));
