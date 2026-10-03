/**
 * SonghaiCRM — o DELETE do painel (`app/api/v1/admin/tenants/[id]/route.ts`)
 * apaga a organização criada por engano numa só instrução e confia no CASCADE
 * para o resto. Esta prova cria a organização pelo MESMO caminho da tela
 * (`fn_create_tenant_with_owner`: vínculo provisório do criador + chave de
 * idempotência), acrescenta o que a criação do SonghaiCRM escreve depois (a
 * assinatura da 9004 e a linha do convite do dono em `team_invites`) e apaga
 * como `service_role`, o papel da rota. Uma FK sem cascade nova, vinda do
 * upstream ou nossa, faria o botão "Apagar" responder 500 — aqui ela aparece.
 *
 * Também mede as colunas que `lib/admin/responsavel-da-organizacao.ts` lê.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { motivoDoErro, sql } from "./psql-transporte";

const ADMIN = "c0510000-0000-4000-8000-0000000000ad";
const CHAVE = "c0510000-0000-4000-8000-0000000000c1";
const SLUG = "apaga-por-inteiro";
let orgId = "";

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values ('${ADMIN}', 'plataforma-apaga@invariant.test') on conflict (id) do nothing;
    insert into public.platform_admins (user_id, granted_by, scope, mfa_required, reason) values ('${ADMIN}', '${ADMIN}', 'full', false, 'fixture') on conflict do nothing;
  `);
  const saida = sql(`
    select 'ID|' || ((public.fn_create_tenant_with_owner(
      '${ADMIN}', '${CHAVE}',
      '{"display_name":"Engano Lda","slug":"${SLUG}","plan":"agente_simples","owner_email":"dono-errado@invariant.test"}'::jsonb,
      repeat('ab', 32)
    ))->>'id');
  `);
  orgId = saida.split("\n").find((l) => l.startsWith("ID|"))!.slice(3).trim();
  sql(`
    insert into public.organization_subscriptions (organization_id, plan_id, status)
      values ('${orgId}', (select id from public.plans where slug = 'agente_simples'), 'active');
    insert into public.team_invites (organization_id, email, role, invited_by, expires_at)
      values ('${orgId}', 'dono-errado@invariant.test', 'admin', '${ADMIN}', now() + interval '1 day');
  `);
});

afterAll(() => {
  sql(`
    delete from public.organizations where slug = '${SLUG}';
    delete from public.platform_admins where user_id = '${ADMIN}';
    delete from auth.users where id = '${ADMIN}';
  `);
});

describe("organização recém-criada apaga por inteiro", () => {
  it("a criação deixou o criador como vínculo PROVISÓRIO (o que o DELETE não conta como uso)", () => {
    const linha = sql(`
      select 'P|' || provisional_until_handover from public.user_organizations
       where organization_id = '${orgId}' and user_id = '${ADMIN}';
    `);
    expect(linha).toContain("P|true");
  });

  it("o convite pendente é lido pelas colunas que o painel usa", () => {
    const linha = sql(`
      select 'C|' || count(*) from public.team_invites
       where organization_id = '${orgId}' and role = 'admin'
         and accepted_at is null and revoked_at is null and email_dispatched is not null;
    `);
    expect(linha).toContain("C|1");
  });

  it("service_role apaga a organização sem erro e não sobra nada dela", () => {
    let erro: string | null = null;
    try {
      sql(`set role service_role; delete from public.organizations where id = '${orgId}'; reset role;`);
    } catch (err) {
      erro = motivoDoErro(err);
    }
    expect(erro).toBeNull();

    const restos = sql(`
      select 'R|' || (
        (select count(*) from public.organizations where id = '${orgId}') +
        (select count(*) from public.user_organizations where organization_id = '${orgId}') +
        (select count(*) from public.team_invites where organization_id = '${orgId}') +
        (select count(*) from public.organization_subscriptions where organization_id = '${orgId}') +
        (select count(*) from public.idempotency_keys where organization_id = '${orgId}')
      );
    `);
    expect(restos).toContain("R|0");
  });
});
