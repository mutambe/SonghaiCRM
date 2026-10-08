-- manifest: **SonghaiCRM — esforço do modelo por agente.** `ai_agent_versions.effort` (`low`/`medium`/`high`/`xhigh`/`max`, nulo = padrão do modelo), escolhido em IA › Agentes ao lado do modelo e enviado à Anthropic como `output_config.effort` nos pontos que são o próprio agente (`agent_turn`, `agent_preview`, `operator_turn`) e no `checkpoint`. Agente novo nasce com Claude Haiku 5.5 e esforço Médio (decisão do dono, 08/10/2026); agentes existentes ficam como estão (coluna nula, sem backfill). Quais níveis cada modelo aceita: `lib/ai/esforco.ts`. Bloco no `supabase/songhai.sql`.

alter table public.ai_agent_versions
  add column if not exists effort text
  check (effort is null or effort in ('low', 'medium', 'high', 'xhigh', 'max'));

comment on column public.ai_agent_versions.effort is
  'Esforço do modelo deste agente (output_config.effort da Anthropic). Nulo = padrão do modelo. Níveis por modelo: lib/ai/esforco.ts.';
