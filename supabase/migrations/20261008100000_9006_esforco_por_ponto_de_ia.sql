-- manifest: **SonghaiCRM — esforço do modelo por ponto de IA.** `ai_purpose_bindings.effort` (`low`/`medium`/`high`/`xhigh`/`max`, nulo = padrão do modelo), escolhido em IA › Provedores ao lado do modelo de cada ponto e enviado à Anthropic como `output_config.effort`. Quais níveis cada modelo aceita mora em `lib/ai/esforco.ts`: a rota recusa nível incompatível na escrita e o motor não envia na leitura (binding antigo nunca vira 400 no atendimento). Coluna nula, sem backfill; o CHECK nasce com a coluna (idempotente: `if not exists`). Bloco no `supabase/songhai.sql`.

alter table public.ai_purpose_bindings
  add column if not exists effort text
  check (effort is null or effort in ('low', 'medium', 'high', 'xhigh', 'max'));

comment on column public.ai_purpose_bindings.effort is
  'Esforço do modelo neste ponto (output_config.effort da Anthropic). Nulo = padrão do modelo. Níveis por modelo: lib/ai/esforco.ts.';
