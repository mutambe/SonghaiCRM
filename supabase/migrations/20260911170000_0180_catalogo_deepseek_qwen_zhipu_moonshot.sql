-- 0180 — catálogo curado de DeepSeek, Qwen, Zhipu AI e Moonshot AI
--
-- Mesmo bug do 0178 (Groq) e 0179 (NVIDIA), quatro provedores de uma vez:
-- `deepseek`, `qwen`, `zhipu` e `moonshot` foram cadastrados em
-- `lib/ai/pontos/provedores.ts` (todos `catalogoSincronizavel: false`) sem
-- NENHUMA linha em `ai_models`. Provedor "manual" depende INTEIRAMENTE de
-- seed por migration — sem ela, `ModelPicker.tsx` bate em
-- `GET /api/v1/ai/providers/<provider>/models`, a query devolve zero linhas,
-- e a tela mostra "Nenhum modelo disponível" pra quem cadastra e VALIDA a
-- chave. Achado ao investigar o mesmo relato para o provedor NVIDIA (0179) e
-- auditar os demais "manuais" da lista.
--
-- `ai_models.input_price_per_million_cents`/`output_price_per_million_cents`
-- são CENTAVOS DE DÓLAR (ver `lib/ai/budget/check.ts:43`) — todo preço abaixo
-- foi convertido ou escolhido para bater nessa unidade, nunca inventado.
--
-- ## DeepSeek — ids e preço verificados em api-docs.deepseek.com/quick_start/pricing (2026-09-11)
--
-- `deepseek-flash` e `deepseek-v4-pro` são os dois modelos correntes (os ids
-- antigos `deepseek-v4-flash`/`deepseek-v4-flash-vision-exp` continuam
-- aceitos mas roteiam pro Flash, então não entram como linha própria). A doc
-- tem preço DINÂMICO por horário (pico 01h-04h e 06h-10h UTC seg-sex custa o
-- dobro do fora-de-pico) e por cache (hit/miss). Gravei o pior caso — pico +
-- cache miss — pelo mesmo motivo do arredondamento pra cima já usado no 0178:
-- a conta nunca pode subestimar o teto de orçamento da organização.
-- `deepseek-v4-pro` vira o padrão (mais capaz, contexto igual).
--
-- ## Qwen — ids e preço verificados em alibabacloud.com/help/en/model-studio/model-pricing (2026-09-11)
--
-- `QWEN_ENDPOINT` deste repo (`dashscope.aliyuncs.com`, sem `-intl`) é a
-- região China (Beijing), então usei a tabela de preço "China (Beijing)" da
-- própria página oficial (que já publica em USD, sem conversão nossa), não a
-- de Singapura. `qwen3.8-max` vira o padrão (mais capaz, 1M de contexto, tool
-- calling confirmado).
--
-- ## Zhipu AI (GLM) — SÓ o modelo gratuito confirmado
--
-- `ZHIPU_ENDPOINT` deste repo é `open.bigmodel.cn` (plataforma doméstica,
-- billing em CNY) — a página de preço em CNY é uma SPA que não renderiza sem
-- JS, e não achei uma tabela CNY oficial estática pra confiar num número por
-- modelo pago. Por isso, igual ao critério do 0178 pros dois Groq "Contact
-- Sales", os modelos PAGOS (glm-5, glm-5.3, glm-4.7, glm-4.7-flashx, etc.)
-- ficam de fora agora — sem preço confiável, inventar quebraria o teto de
-- orçamento. Só `glm-4.7-flash` entra: docs.bigmodel.cn hospeda o model card
-- dele sob o path `.../guide/models/free/glm-4.7-flash` (confirmado
-- 2026-09-11) — gratuito de verdade, preço `0` é zero CONHECIDO. Ele também
-- vira o único default possível. Ampliar este catálogo com os modelos pagos é
-- trabalho futuro, condicionado a achar a tabela de preço oficial em texto.
--
-- ## Moonshot AI (Kimi) — ids verificados, preço em USD da tabela internacional
--
-- `MOONSHOT_ENDPOINT` deste repo é `api.moonshot.cn` (doméstico, CNY), mas a
-- própria Moonshot publica o MESMO catálogo (kimi-k3, kimi-k2.6) com preço em
-- USD na doc internacional (platform.kimi.ai/docs/pricing/chat, 2026-09-11) —
-- convertendo a tabela CNY doméstica (¥20/¥100 por milhão, cache miss, pra
-- kimi-k3) por câmbio corrente o resultado bate dentro de ~3% do preço USD
-- oficial (~$3,08 vs $3,00 publicado), então usei o preço USD PUBLICADO pela
-- própria empresa em vez de estimar câmbio — é preço de primeira mão, não
-- conversão nossa. Cache miss (pior caso) por padrão. `kimi-k3` vira o
-- padrão (contexto 1M, tool calling confirmado).
--
-- Idempotente: `on conflict do update`, seguro em re-aplicação.

insert into public.ai_models
  (provider, model_id, display_name, description,
   context_window, input_price_per_million_cents, output_price_per_million_cents, supports_tools)
values
  -- DeepSeek
  ('deepseek', 'deepseek-v4-pro', 'DeepSeek V4 Pro',
   'Modelo principal da DeepSeek, forte em raciocínio e código. Preço no pior caso (horário de pico + cache miss) para não subestimar o orçamento.',
   1048576, 132, 396, true),
  ('deepseek', 'deepseek-flash', 'DeepSeek Flash',
   'Versão mais rápida e barata da DeepSeek. Preço no pior caso (horário de pico + cache miss).',
   1048576, 30, 120, true),
  -- Qwen (Alibaba Cloud / DashScope, região China/Beijing)
  ('qwen', 'qwen3.8-max', 'Qwen3.8 Max',
   'Modelo flagship da Alibaba Cloud — o mais capaz da família Qwen3.8, com function calling e 1M de contexto.',
   1000000, 165, 496, true),
  ('qwen', 'qwen3.7-plus', 'Qwen3.7 Plus',
   'Meio-termo de custo/capacidade da família Qwen, faixa de contexto até 256K.',
   1000000, 28, 111, true),
  ('qwen', 'qwen3.8-flash', 'Qwen3.8 Flash',
   'Versão mais barata e rápida da família Qwen3.8, ainda com 1M de contexto e function calling.',
   1000000, 12, 39, true),
  -- Zhipu AI (GLM) — só o modelo com preço público confirmado (gratuito)
  ('zhipu', 'glm-4.7-flash', 'GLM-4.7 Flash (gratuito)',
   'Modelo gratuito da Zhipu AI para uso comum — gratuito conforme a documentação do provedor; pode virar pago sem aviso. Modelos GLM pagos (glm-5, glm-4.7, etc.) ainda não entraram no catálogo por falta de tabela de preço oficial confiável em texto.',
   200000, 0, 0, true),
  -- Moonshot AI (Kimi)
  ('moonshot', 'kimi-k3', 'Kimi K3',
   'Modelo flagship da Moonshot AI, 1M de contexto e tool calling — preço no pior caso (cache miss).',
   1048576, 300, 1500, true),
  ('moonshot', 'kimi-k2.6', 'Kimi K2.6',
   'Modelo de propósito geral mais barato da Moonshot AI — preço no pior caso (cache miss).',
   262144, 95, 400, true)
on conflict (provider, model_id) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  context_window = excluded.context_window,
  input_price_per_million_cents = excluded.input_price_per_million_cents,
  output_price_per_million_cents = excluded.output_price_per_million_cents,
  supports_tools = excluded.supports_tools;

update public.ai_models set is_default_for_provider = false
 where provider in ('deepseek', 'qwen', 'zhipu', 'moonshot') and is_default_for_provider;

update public.ai_models set is_default_for_provider = true
 where (provider, model_id) in (
   ('deepseek', 'deepseek-v4-pro'),
   ('qwen', 'qwen3.8-max'),
   ('zhipu', 'glm-4.7-flash'),
   ('moonshot', 'kimi-k3')
 );
