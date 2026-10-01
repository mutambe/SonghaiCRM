/**
 * Pagamentos PaySuite (migration 0503, SonghaiCRM).
 *
 * `payment_credentials` segura token de API e segredo de webhook de pagamento:
 * o PostgREST não pode servi-la a ninguém. `payments` é o log de cobrança que a
 * tela do negócio lê: cada organização vê só os seus, e ninguém escreve pelo
 * client de sessão — quem grava é a rota de cobrança e o webhook (service role).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { motivoDoErro, sql } from "./psql-transporte";

const ORG_A = "a0503000-0000-4000-8000-00000000000a";
const ORG_B = "b0503000-0000-4000-8000-00000000000b";
const USER_A = "a0503000-0000-4000-8000-0000000000aa";
const MARCA = "N|";

function privilegiosDe(tabela: string, papel: string): string {
  return sql(`
    select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), 'NENHUM')
      from information_schema.role_table_grants
     where table_schema = 'public' and table_name = '${tabela}' and grantee = '${papel}';
  `).trim();
}

function erroSob(papel: string, comando: string): string | null {
  try {
    sql(`set role ${papel};\n${comando};\nreset role;`);
    return null;
  } catch (err) {
    return motivoDoErro(err);
  }
}

/** Roda `consulta` como o usuário logado `uid` e devolve o número da linha marcada. */
function comoUsuario(uid: string, consulta: string): number {
  const saida = sql(`
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', false);
    ${consulta};
    reset role;
  `);
  const linha = saida.split("\n").find((l) => l.startsWith(MARCA));
  return Number(linha?.slice(MARCA.length));
}

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values ('${USER_A}', 'paysuite-a@invariant.test') on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'paysuite-org-a', 'Loja A', 'Loja A'),
      ('${ORG_B}', 'paysuite-org-b', 'Loja B', 'Loja B')
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${USER_A}', '${ORG_A}', 'admin', now()) on conflict do nothing;
    delete from public.payments where organization_id in ('${ORG_A}', '${ORG_B}');
    insert into public.payments (organization_id, provider_payment_id, reference, amount_cents) values
      ('${ORG_A}', 'ps-a-1', 'ref-a-1', 150000),
      ('${ORG_B}', 'ps-b-1', 'ref-b-1', 990000);
  `);
});

afterAll(() => {
  sql(`
    delete from public.payments where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from public.user_organizations where user_id = '${USER_A}';
    delete from public.organizations where id in ('${ORG_A}', '${ORG_B}');
    delete from auth.users where id = '${USER_A}';
  `);
});

describe("payment_credentials: o PostgREST não serve segredo de pagamento", () => {
  it("anon e authenticated sem privilégio nenhum; service_role com (controle da sonda)", () => {
    expect(privilegiosDe("payment_credentials", "anon")).toBe("NENHUM");
    expect(privilegiosDe("payment_credentials", "authenticated")).toBe("NENHUM");
    expect(privilegiosDe("payment_credentials", "service_role")).toMatch(/INSERT.*SELECT.*UPDATE/);
  });

  it("authenticated é BARRADO ao ler — permission denied, não zero linhas", () => {
    expect(erroSob("authenticated", "select id from public.payment_credentials")).toContain("permission denied");
  });

  it("RLS ligada e nenhuma policy", () => {
    expect(sql(`select relrowsecurity from pg_class where oid = 'public.payment_credentials'::regclass;`).trim()).toBe("t");
    expect(sql(`select count(*) from pg_policies where schemaname = 'public' and tablename = 'payment_credentials';`).trim()).toBe("0");
  });
});

describe("payments: cada organização vê só os seus, e ninguém escreve pela sessão", () => {
  it("o usuário da organização A vê o pagamento de A", () => {
    expect(comoUsuario(USER_A, `select '${MARCA}' || count(*) from public.payments where organization_id = '${ORG_A}'`)).toBe(1);
  });

  it("⭐ e NÃO vê o da organização B", () => {
    expect(comoUsuario(USER_A, `select '${MARCA}' || count(*) from public.payments where organization_id = '${ORG_B}'`)).toBe(0);
  });

  it("authenticated é BARRADO ao escrever", () => {
    const erro = erroSob(
      "authenticated",
      `insert into public.payments (organization_id, provider_payment_id, reference, amount_cents) values ('${ORG_A}', 'x', 'y', 1)`,
    );
    expect(erro).toContain("permission denied");
  });

  it("anon não tem privilégio nenhum", () => {
    expect(privilegiosDe("payments", "anon")).toBe("NENHUM");
  });

  it("a reentrega do webhook não grava dois pagamentos (unique do lado do PaySuite)", () => {
    const erro = (() => {
      try {
        sql(`insert into public.payments (organization_id, provider_payment_id, reference, amount_cents) values ('${ORG_A}', 'ps-a-1', 'ref-outra', 150000);`);
        return null;
      } catch (err) {
        return motivoDoErro(err);
      }
    })();
    expect(erro).toMatch(/duplicate key|unique/i);
  });
});
