-- 0179 — catálogo curado do NVIDIA NIM
--
-- Mesmo bug do 0178 (Groq), provedor diferente: `nvidia` foi cadastrado em
-- `lib/ai/pontos/provedores.ts` sem nenhuma linha em `ai_models`. Provedor
-- "manual" (`catalogoSincronizavel: false`) depende INTEIRAMENTE de seed por
-- migration — sem ela, `ModelPicker.tsx` bate em
-- `GET /api/v1/ai/providers/nvidia/models`, a query em `ai_models` devolve
-- zero linhas, e a tela mostra "Nenhum modelo disponível": o operador
-- cadastra e VALIDA a chave NVIDIA com sucesso e não consegue escolher
-- NENHUM modelo para o agente rodar — o próprio bug reportado.
--
-- IDS VERIFICADOS em `build.nvidia.com` e `docs.api.nvidia.com/nim/reference`
-- (consulta em 2026-09-11): `meta/llama-3.3-70b-instruct`,
-- `meta/llama-3.1-8b-instruct` e `nvidia/llama-3.1-nemotron-70b-instruct`
-- existem no catálogo hospedado, com function calling suportado.
--
-- PREÇO: build.nvidia.com **não publica preço por token para o próprio
-- endpoint hospedado** — a própria página do provedor anuncia "Free inference
-- with leading models" (catálogo hospedado é evaluation tier por créditos,
-- não billing por token; preço por token só existe para deploy self-hosted
-- da NIM em infra própria do cliente, que é OUTRO produto, fora do escopo
-- desta credencial). Mesmo caso do `groq/compound` na 0178: preço `0` aqui é
-- um zero CONHECIDO (documentado pelo próprio provedor), não a ausência de
-- dado — inventar um número pago quebraria o teto de orçamento da
-- organização com um valor que ninguém cobrou. Sujeito a virar pago sem
-- aviso, como todo catálogo "manual" desta lista.
--
-- `meta/llama-3.3-70b-instruct` vira o padrão do provedor: é o mais capaz dos
-- três (131072 de contexto, tool calling) — critério igual ao usado em groq.
--
-- Idempotente: `on conflict do update`, seguro em re-aplicação.

insert into public.ai_models
  (provider, model_id, display_name, description,
   context_window, input_price_per_million_cents, output_price_per_million_cents, supports_tools)
values
  ('nvidia', 'meta/llama-3.3-70b-instruct', 'Llama 3.3 70B (NVIDIA NIM)',
   'Modelo Llama 3.3 hospedado pela NVIDIA, com function calling — o mais capaz do catálogo hospedado gratuito.',
   131072, 0, 0, true),
  ('nvidia', 'meta/llama-3.1-8b-instruct', 'Llama 3.1 8B (NVIDIA NIM)',
   'Versão menor do Llama, hospedada pela NVIDIA — mais rápido para tarefas simples.',
   131072, 0, 0, true),
  ('nvidia', 'nvidia/llama-3.1-nemotron-70b-instruct', 'Nemotron 70B (NVIDIA NIM)',
   'Llama 3.1 70B ajustado pela própria NVIDIA (Nemotron), otimizado para seguir instrução com precisão.',
   131072, 0, 0, true)
on conflict (provider, model_id) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  context_window = excluded.context_window,
  input_price_per_million_cents = excluded.input_price_per_million_cents,
  output_price_per_million_cents = excluded.output_price_per_million_cents,
  supports_tools = excluded.supports_tools;

update public.ai_models set is_default_for_provider = false
 where provider = 'nvidia' and is_default_for_provider;

update public.ai_models set is_default_for_provider = true
 where provider = 'nvidia' and model_id = 'meta/llama-3.3-70b-instruct';
