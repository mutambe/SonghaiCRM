/**
 * Licença por organização (migration 0504, SonghaiCRM).
 *
 * `plans` é o catálogo: qualquer usuário logado lê, ninguém escreve pela sessão.
 * `organization_subscriptions` é a assinatura: cada organização vê só a sua, e
 * nunca há duas vigentes ao mesmo tempo.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { motivoDoErro, sql } from "./psql-transporte";

const ORG_A = "a0504000-0000-4000-8000-00000000000a";
const ORG_B = "b0504000-0000-4000-8000-00000000000b";
const USER_A = "a0504000-0000-4000-8000-0000000000aa";
const MARCA = "N|";

function privilegiosDe(tabela: string, papel: string): string {
  return sql(`
    select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), 'NENHUM')
      from information_schema.role_table_grants
     where table_schema = 'public' and table_name = '${tabela}' and grantee = '${papel}';
  `).trim();
}

function erroDe(comando: string): string | null {
  try {
    sql(comando);
    return null;
  } catch (err) {
    return motivoDoErro(err);
  }
}

function comoUsuario(uid: string, consulta: string): number {
  const saida = sql(`
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', false);
    ${consulta};
    reset role;
  `);
  return Number(saida.split("\n").find((l) => l.startsWith(MARCA))?.slice(MARCA.length));
}

const plano = (slug: string) => `(select id from public.plans where slug = '${slug}')`;

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values ('${USER_A}', 'licenca-a@invariant.test') on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'licenca-org-a', 'Loja A', 'Loja A'),
      ('${ORG_B}', 'licenca-org-b', 'Loja B', 'Loja B')
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${USER_A}', '${ORG_A}', 'admin', now()) on conflict do nothing;
    delete from public.organization_subscriptions where organization_id in ('${ORG_A}', '${ORG_B}');
    insert into public.organization_subscriptions (organization_id, plan_id, status) values
      ('${ORG_A}', ${plano("agente_simples")}, 'active'),
      ('${ORG_B}', ${plano("agente_avancado")}, 'active');
  `);
});

afterAll(() => {
  sql(`
    delete from public.organization_subscriptions where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from public.user_organizations where user_id = '${USER_A}';
    delete from public.organizations where id in ('${ORG_A}', '${ORG_B}');
    delete from auth.users where id = '${USER_A}';
  `);
});

describe("o catálogo de planos", () => {
  it("nasce com os quatro pacotes em meticais, e o Enterprise sem limite", () => {
    const linhas = sql(`select slug || '|' || currency || '|' || coalesce(limits->>'max_users', '∞') from public.plans order by slug;`)
      .trim()
      .split("\n");
    expect(linhas).toEqual([
      "agente_avancado|MZN|200",
      "agente_medio|MZN|50",
      "agente_simples|MZN|20",
      "enterprise|MZN|∞",
    ]);
  });

  it("reaplicar o seed não duplica (on conflict do slug)", () => {
    expect(sql(`select count(*) from public.plans;`).trim()).toBe("4");
  });

  it("usuário logado lê o catálogo; anon não tem privilégio nenhum", () => {
    expect(comoUsuario(USER_A, `select '${MARCA}' || count(*) from public.plans`)).toBe(4);
    expect(privilegiosDe("plans", "anon")).toBe("NENHUM");
  });

  it("authenticated não escreve no catálogo", () => {
    expect(erroDe(`set role authenticated; update public.plans set price_cents = 1; reset role;`)).toContain("permission denied");
  });
});

describe("a assinatura de cada organização", () => {
  it("o usuário da organização A vê a assinatura de A", () => {
    expect(comoUsuario(USER_A, `select '${MARCA}' || count(*) from public.organization_subscriptions where organization_id = '${ORG_A}'`)).toBe(1);
  });

  it("⭐ e NÃO vê a da organização B", () => {
    expect(comoUsuario(USER_A, `select '${MARCA}' || count(*) from public.organization_subscriptions where organization_id = '${ORG_B}'`)).toBe(0);
  });

  it("anon sem privilégio; authenticated não escreve", () => {
    expect(privilegiosDe("organization_subscriptions", "anon")).toBe("NENHUM");
    const erro = erroDe(
      `set role authenticated; insert into public.organization_subscriptions (organization_id, plan_id, status) values ('${ORG_A}', ${plano("enterprise")}, 'active'); reset role;`,
    );
    expect(erro).toContain("permission denied");
  });

  it("nunca duas assinaturas vigentes na mesma organização", () => {
    const erro = erroDe(
      `insert into public.organization_subscriptions (organization_id, plan_id, status) values ('${ORG_A}', ${plano("agente_medio")}, 'active');`,
    );
    expect(erro).toMatch(/uq_organization_subscriptions_one_current|duplicate key/);
  });

  it("fn_trocar_plano_da_organizacao troca numa só transação, e o histórico fica", () => {
    sql(`select public.fn_trocar_plano_da_organizacao('${ORG_B}', ${plano("enterprise")}, null, 'upgrade');`);
    const vigentes = sql(
      `select p.slug from public.organization_subscriptions s join public.plans p on p.id = s.plan_id where s.organization_id = '${ORG_B}' and s.ended_at is null;`,
    ).trim();
    expect(vigentes).toBe("enterprise");
    expect(sql(`select count(*) from public.organization_subscriptions where organization_id = '${ORG_B}';`).trim()).toBe("2");
  });

  it("plano fora de venda é recusado sem mexer na assinatura vigente", () => {
    sql(`update public.plans set is_active = false where slug = 'agente_medio';`);
    try {
      expect(erroDe(`select public.fn_trocar_plano_da_organizacao('${ORG_B}', ${plano("agente_medio")}, null);`)).toContain("plan_inactive");
      expect(
        sql(`select p.slug from public.organization_subscriptions s join public.plans p on p.id = s.plan_id where s.organization_id = '${ORG_B}' and s.ended_at is null;`).trim(),
      ).toBe("enterprise");
    } finally {
      sql(`update public.plans set is_active = true where slug = 'agente_medio';`);
    }
  });

  it("⭐ nem anon nem authenticated chamam a troca de plano", () => {
    for (const papel of ["anon", "authenticated"]) {
      const erro = erroDe(`set role ${papel}; select public.fn_trocar_plano_da_organizacao('${ORG_A}', ${plano("enterprise")}, null); reset role;`);
      expect(erro, papel).toContain("permission denied");
    }
  });

  it("encerrar a vigente libera a troca de plano — o histórico fica", () => {
    sql(`
      update public.organization_subscriptions set ended_at = now() where organization_id = '${ORG_A}' and ended_at is null;
      insert into public.organization_subscriptions (organization_id, plan_id, status) values ('${ORG_A}', ${plano("agente_medio")}, 'active');
    `);
    expect(sql(`select count(*) from public.organization_subscriptions where organization_id = '${ORG_A}';`).trim()).toBe("2");
    expect(
      sql(`select p.slug from public.organization_subscriptions s join public.plans p on p.id = s.plan_id where s.organization_id = '${ORG_A}' and s.ended_at is null;`).trim(),
    ).toBe("agente_medio");
  });
});
