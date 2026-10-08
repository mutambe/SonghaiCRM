-- manifest: **SonghaiCRM — os modelos atuais da Anthropic entram no catálogo: Claude Fable 5.1, Opus 5.5, Sonnet 5.5 e Haiku 5.5.** O seletor de modelos do provedor Anthropic lê `ai_models` (catálogo curado por migration — o cron `sync-model-catalog` só atualiza as linhas da OpenRouter), e o mais novo ali era o Sonnet 5/Opus 5 da 0104: quem configurava a chave da Claude não via os modelos correntes. Insere os quatro com preço, janela de 1M e `supports_tools`, e a mesma lista em `ai_pricing` (senão o gasto sai NULL e não conta no teto). O padrão do provedor continua `claude-sonnet-5` — trocar o modelo que agentes novos recebem é decisão do dono, não efeito colateral. Idempotente por `on conflict do update`. Bloco no `supabase/songhai.sql`.
--
-- SonghaiCRM — 9005: MODELOS CLAUDE 5.5 NO CATÁLOGO.
--
-- Preços da Anthropic (USD por milhão de tokens, API primária), em centavos:
--   claude-fable-5-1   $10 / $50
--   claude-opus-5-5    $4  / $20
--   claude-sonnet-5-5  $2  / $10
--   claude-haiku-5-5   $0,10 / $0,50 até 100 mil tokens de entrada ($0,50 / $2,50 acima;
--                      o catálogo guarda a faixa de base)
--
-- Atenção ao escolher um destes para um ponto: nos quatro, `thinking` não pode
-- ser desligado e `tool_choice` forçado (`any`/`tool`) devolve 400. O agente de
-- atendimento usa `auto`, então não é afetado; a análise de sentimento usa
-- `generateObject` e está fixada no Haiku 4.5 (`DEFAULT_CLASSIFIER_MODEL`).

insert into public.ai_models
  (provider, model_id, display_name, description, context_window,
   input_price_per_million_cents, output_price_per_million_cents, supports_tools)
values
  ('anthropic', 'claude-fable-5-1',  'Claude Fable 5.1',
   'O mais capaz da Anthropic, para raciocínio e trabalho agêntico exigentes. Custo acima do Opus; respostas podem demorar.',
   1000000, 1000, 5000, true),
  ('anthropic', 'claude-opus-5-5',   'Claude Opus 5.5',
   'O Opus atual: muito capaz para agentes, mais barato que o Opus 5.',
   1000000, 400, 2000, true),
  ('anthropic', 'claude-sonnet-5-5', 'Claude Sonnet 5.5',
   'O Sonnet atual: rapidez e capacidade para atendimento e agentes.',
   1000000, 200, 1000, true),
  ('anthropic', 'claude-haiku-5-5',  'Claude Haiku 5.5',
   'O mais rápido e barato: classificação, extração e encaminhamento. Acima de 100 mil tokens de entrada o preço sobe para $0,50/$2,50 por milhão.',
   1000000, 10, 50, true)
on conflict (provider, model_id) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  context_window = excluded.context_window,
  input_price_per_million_cents = excluded.input_price_per_million_cents,
  output_price_per_million_cents = excluded.output_price_per_million_cents,
  supports_tools = excluded.supports_tools,
  deprecated_at = null;

insert into public.ai_pricing
  (model, prompt_cents_per_million_tokens, completion_cents_per_million_tokens, notes)
values
  ('claude-fable-5-1',  1000, 5000, 'catálogo 9005'),
  ('claude-opus-5-5',    400, 2000, 'catálogo 9005'),
  ('claude-sonnet-5-5',  200, 1000, 'catálogo 9005'),
  ('claude-haiku-5-5',    10,   50, 'catálogo 9005 — até 100 mil tokens de entrada; acima, 50/250')
on conflict (model) do update set
  prompt_cents_per_million_tokens = excluded.prompt_cents_per_million_tokens,
  completion_cents_per_million_tokens = excluded.completion_cents_per_million_tokens,
  notes = excluded.notes,
  superseded_at = null;
