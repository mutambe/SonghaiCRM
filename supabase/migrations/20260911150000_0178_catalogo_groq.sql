-- 0178 — catálogo curado do Groq
--
-- O provedor Groq foi cadastrado em `lib/ai/pontos/provedores.ts` sem nenhuma
-- linha em `ai_models`. Provedor "manual" (não sincronizável, ver
-- `catalogoSincronizavel: false`) depende INTEIRAMENTE de seed por migration —
-- sem ela, `ModelPicker.tsx` bate em `GET /api/v1/ai/providers/groq/models`,
-- a query em `ai_models` devolve zero linhas, e a tela mostra "Nenhum modelo
-- disponível": o operador cadastra a chave, valida com sucesso, e não
-- consegue escolher NENHUM modelo para o agente rodar. Achado ao cadastrar
-- uma chave Groq de verdade.
--
-- IDS E PREÇO VERIFICADOS na documentação pública do provedor
-- (`console.groq.com/docs/models`, consulta em 2026-09-11) — o endpoint
-- `GET /openai/v1/models` exige chave (ao contrário da OpenRouter, cujo
-- catálogo é público sem auth), então não dá pra confirmar por `curl` sem
-- BYOK, e por isso este catálogo é seed manual, não cron de sincronização.
--
-- `llama-3.3-70b-versatile` e `llama-3.1-8b-instant` — os dois modelos mais
-- conhecidos do Groq — FICARAM DE FORA DE PROPÓSITO: na consulta de hoje a
-- própria doc do provedor lista o preço deles como "Contact Sales" (tier
-- Enterprise), sem número público. `tests/invariants/catalogo-de-modelos.test.ts`
-- exige preço numérico em todo modelo não-depreciado do catálogo — inventar um
-- valor para o teste passar seria exatamente o "número inventado numa coluna
-- que alimenta o teto de orçamento" que a doutrina do repo proíbe. Se o Groq
-- publicar preço self-serve para eles, esta migration é o lugar de acrescentar.
--
-- `groq/compound` e `groq/compound-mini` são gratuitos de fato (a doc os
-- descreve como "gratuito para avaliação") — preço 0 aqui é um zero
-- CONHECIDO, não a ausência de dado; distinção já registrada em
-- `lib/ai/catalogo/openrouter.ts:precoParaCentavosPorMilhao`. Sujeito a virar
-- pago sem aviso.
--
-- `openai/gpt-oss-20b`: a doc publica $0,075 de entrada por milhão de tokens;
-- a coluna é inteiro em CENTAVOS por milhão, então 7,5 arredonda para CIMA (8)
-- — mesma regra de "nunca subestimar o teto de orçamento" já em
-- `lib/ai/catalogo/openrouter.ts`.
--
-- `openai/gpt-oss-120b` vira o padrão do provedor: é o único dos dois com
-- preço confirmado e capacidade maior — critério igual ao usado nos outros
-- provedores curados (o mais capaz entre os que têm preço confirmado).
--
-- Idempotente: `on conflict do update`, seguro em re-aplicação.

insert into public.ai_models
  (provider, model_id, display_name, description,
   context_window, input_price_per_million_cents, output_price_per_million_cents, supports_tools)
values
  ('groq', 'openai/gpt-oss-120b', 'GPT-OSS 120B (Groq)',
   'Modelo open-weight da OpenAI, hospedado no Groq com inferência muito rápida (LPU).',
   131072, 15, 60, true),
  ('groq', 'openai/gpt-oss-20b', 'GPT-OSS 20B (Groq)',
   'Versão menor do GPT-OSS, hospedado no Groq — mais barato para tarefas simples.',
   131072, 8, 30, true),
  ('groq', 'groq/compound', 'Groq Compound',
   'Sistema agêntico do próprio Groq com ferramentas embutidas — gratuito para avaliação conforme a documentação do provedor; pode virar pago sem aviso.',
   null, 0, 0, false),
  ('groq', 'groq/compound-mini', 'Groq Compound Mini',
   'Versão menor do Compound — gratuito para avaliação conforme a documentação do provedor; pode virar pago sem aviso.',
   null, 0, 0, false)
on conflict (provider, model_id) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  context_window = excluded.context_window,
  input_price_per_million_cents = excluded.input_price_per_million_cents,
  output_price_per_million_cents = excluded.output_price_per_million_cents,
  supports_tools = excluded.supports_tools;

update public.ai_models set is_default_for_provider = false
 where provider = 'groq' and is_default_for_provider;

update public.ai_models set is_default_for_provider = true
 where provider = 'groq' and model_id = 'openai/gpt-oss-120b';
