-- Torna organizations.legal_name nullable.
--
-- Achado rodando o E2E do fluxo de criação de tenant por platform admin
-- (tests/e2e/admin-cria-tenant-convite-owner.spec.ts): o formulário
-- (app/admin/(protected)/tenants/new/_form.tsx) e o schema da API
-- (app/api/v1/admin/tenants/route.ts, createSchema) sempre trataram
-- "Razão social" como campo OPCIONAL — sem asterisco na tela, Zod com
-- `.optional()` — porque o platform admin que cria o tenant raramente sabe a
-- razão social da empresa; quem preenche depois é o próprio tenant, em
-- Configurações (app/actions/settings/updateTenant.ts, lá sim obrigatório).
-- O resto do código já lê o campo como nullable em toda parte
-- (lib/legal/operador.ts, lib/lgpd/export-collector.ts,
-- lib/lgpd/pdf-renderer.tsx — todos com `?.`/`??`/`|| null`; o PATCH de
-- /admin/tenants/[id] já aceita `.nullable()`). Só a coluna, herdada do
-- schema anterior a essa feature (bootstrap-owner sempre grava
-- legal_name = display_name), nunca foi relaxada — POST
-- /api/v1/admin/tenants estourava 500 (`null value in column "legal_name"
-- ... violates not-null constraint`) sempre que o campo ficava em branco.
alter table "public"."organizations"
  alter column "legal_name" drop not null;
