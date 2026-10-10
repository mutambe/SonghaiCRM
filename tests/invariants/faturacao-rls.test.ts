import { beforeAll, describe, expect, it } from "vitest";

import { GOV_ADMIN, GOV_AGENT_A, GOV_MANAGER, GOV_ORG, GOV_VIEWER, countAs, lastLine, seedGov, sql } from "./gov-helpers";

/**
 * SonghaiCRM — o dinheiro e os avisos de cada cliente não vazam para o vizinho
 * (migrations 9010, 9011 e 9012). Roda só via `pnpm test:db`.
 *
 * As cinco tabelas por organização desta distribuição:
 *
 *   subscription_items          os extras que um cliente contratou
 *   billing_invoices            as facturas do cliente
 *   billing_invoice_lines       o que compõe cada factura
 *   ai_token_alerts             os avisos de tokens de IA do cliente
 *   config_aviso_de_caso_email  quem recebe o aviso de caso por e-mail
 *
 * Fora de `TABLES` (rls-isolation.test.ts) DE PROPÓSITO: o utilizador semeado ali é
 * `agent`, e estas tabelas só deixam o ADMINISTRADOR da organização ler — dinheiro
 * não é assunto de quem atende. O controlo positivo falharia por acerto, e a
 * «correcção» natural seria afrouxar a policy para caber no molde. A varredura
 * (`rls-completude-varredura.test.ts`) cita este ficheiro em PROVA_PROPRIA.
 *
 * Cinco perguntas por tabela, cada uma com o controlo que impede o verde por vazio:
 *
 *   1. o admin da organização lê as linhas dela (controlo positivo);
 *   2. o admin de A lê 0 de B, e o de B lê 0 de A (as duas direcções);
 *   3. manager, agent e viewer da PRÓPRIA organização leem 0 (gate de papel);
 *   4. `authenticated` e `anon` não têm privilégio de escrever, e anon nem de ler;
 *   5. a tentativa de escrever como admin falha e a linha fica intacta.
 */

const ORG_B = "fa7a0000-0000-4000-8000-00000000000b";
const ADMIN_B = "fa7a0000-1111-4000-8000-00000000000b";

const SUB_A = "fa7a0000-2222-4000-8000-00000000000a";
const SUB_B = "fa7a0000-2222-4000-8000-00000000000b";
const FATURA_A = "fa7a0000-3333-4000-8000-00000000000a";
const FATURA_B = "fa7a0000-3333-4000-8000-00000000000b";

const TABELAS = [
  "subscription_items",
  "billing_invoices",
  "billing_invoice_lines",
  "ai_token_alerts",
  "config_aviso_de_caso_email",
] as const;

beforeAll(() => {
  seedGov();
  sql(`
    insert into auth.users (id, email) values ('${ADMIN_B}', 'faturacao-b@invariant.test') on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG_B}', 'fat-inv-b', 'Faturacao B', 'Faturacao B') on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${ADMIN_B}', '${ORG_B}', 'admin', now()) on conflict do nothing;

    -- uma assinatura vigente por organização (índice único parcial)
    insert into public.organization_subscriptions (id, organization_id, plan_id, status)
      select '${SUB_A}', '${GOV_ORG}', p.id, 'active' from public.plans p where p.slug = 'agente_medio'
       and not exists (select 1 from public.organization_subscriptions s where s.organization_id = '${GOV_ORG}' and s.ended_at is null);
    insert into public.organization_subscriptions (id, organization_id, plan_id, status)
      select '${SUB_B}', '${ORG_B}', p.id, 'active' from public.plans p where p.slug = 'agente_medio'
       and not exists (select 1 from public.organization_subscriptions s where s.organization_id = '${ORG_B}' and s.ended_at is null);

    insert into public.subscription_items (organization_id, kind, description, unit_price_cents, recurrence) values
      ('${GOV_ORG}', 'custom', 'Extra de A', 100000, 'monthly'),
      ('${ORG_B}', 'custom', 'Extra de B', 200000, 'monthly');

    insert into public.billing_invoices (id, organization_id, subscription_id, period_start, period_end, due_date, amount_cents, reference) values
      ('${FATURA_A}', '${GOV_ORG}', '${SUB_A}', '2026-10-10', '2026-11-09', '2026-10-15', 800000, 'fat-inv-a'),
      ('${FATURA_B}', '${ORG_B}', '${SUB_B}', '2026-10-10', '2026-11-09', '2026-10-15', 900000, 'fat-inv-b');

    insert into public.billing_invoice_lines (invoice_id, organization_id, position, kind, description, amount_cents) values
      ('${FATURA_A}', '${GOV_ORG}', 1, 'plano', 'Mensalidade de A', 800000),
      ('${FATURA_B}', '${ORG_B}', 1, 'plano', 'Mensalidade de B', 900000);

    insert into public.ai_token_alerts (organization_id, window_start, window_end, level, consumed_tokens, quota_tokens) values
      ('${GOV_ORG}', '2026-10-10', '2026-11-09', 80, 80000, 100000),
      ('${ORG_B}', '2026-10-10', '2026-11-09', 80, 80000, 100000);

    insert into public.config_aviso_de_caso_email (organization_id, emails, ligado) values
      ('${GOV_ORG}', '{a@fat.invariant.test}', true),
      ('${ORG_B}', '{b@fat.invariant.test}', true)
    on conflict (organization_id) do nothing;
  `);
});

/** Corre `dml` como `authenticated` com o JWT do utilizador; devolve `negado` ou `passou`. */
function escreverComo(userId: string, dml: string): "negado" | "passou" {
  try {
    sql(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
      ${dml};
    `);
    return "passou";
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? "";
    if (stderr.includes("permission denied") || stderr.includes("row-level security")) return "negado";
    throw err;
  }
}

const privilegio = (papel: string, tabela: string, qual: string): string =>
  lastLine(sql(`select has_table_privilege('${papel}', 'public.${tabela}', '${qual}');`));

describe.each(TABELAS)("%s — isolamento e gate de papel", (tabela) => {
  it("as duas organizações têm linhas (a prova não é por vazio)", () => {
    expect(
      Number(lastLine(sql(`select count(distinct organization_id) from public.${tabela} where organization_id in ('${GOV_ORG}', '${ORG_B}');`))),
    ).toBe(2);
  });

  it("o admin da organização lê as linhas dela (controlo positivo)", () => {
    expect(countAs(GOV_ADMIN, `select count(*) from public.${tabela} where organization_id = '${GOV_ORG}';`)).toBeGreaterThanOrEqual(1);
    expect(countAs(ADMIN_B, `select count(*) from public.${tabela} where organization_id = '${ORG_B}';`)).toBeGreaterThanOrEqual(1);
  });

  it("o admin de A não lê nada de B, e o de B não lê nada de A", () => {
    expect(countAs(GOV_ADMIN, `select count(*) from public.${tabela} where organization_id = '${ORG_B}';`)).toBe(0);
    expect(countAs(ADMIN_B, `select count(*) from public.${tabela} where organization_id = '${GOV_ORG}';`)).toBe(0);
  });

  it("sem filtro nenhum, o admin só vê a própria organização", () => {
    expect(countAs(GOV_ADMIN, `select count(*) from public.${tabela} where organization_id <> '${GOV_ORG}';`)).toBe(0);
  });

  it("manager, agent e viewer da PRÓPRIA organização não leem: dinheiro é do administrador", () => {
    for (const quem of [GOV_MANAGER, GOV_AGENT_A, GOV_VIEWER]) {
      expect(countAs(quem, `select count(*) from public.${tabela} where organization_id = '${GOV_ORG}';`), quem).toBe(0);
    }
  });

  it("authenticated só tem SELECT, e anon não tem nada", () => {
    expect(privilegio("authenticated", tabela, "SELECT")).toBe("t");
    for (const qual of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
      expect(privilegio("authenticated", tabela, qual), `authenticated ${qual}`).toBe("f");
      expect(privilegio("anon", tabela, qual), `anon ${qual}`).toBe("f");
    }
    expect(privilegio("anon", tabela, "SELECT")).toBe("f");
  });

  it("o admin não consegue alterar nem apagar a própria linha por fora do servidor, e ela fica intacta", () => {
    const antes = Number(lastLine(sql(`select count(*) from public.${tabela} where organization_id = '${GOV_ORG}';`)));
    expect(escreverComo(GOV_ADMIN, `update public.${tabela} set organization_id = organization_id where organization_id = '${GOV_ORG}'`)).toBe("negado");
    expect(escreverComo(GOV_ADMIN, `delete from public.${tabela} where organization_id = '${GOV_ORG}'`)).toBe("negado");
    expect(escreverComo(GOV_ADMIN, `delete from public.${tabela} where organization_id = '${ORG_B}'`)).toBe("negado");
    const depois = Number(lastLine(sql(`select count(*) from public.${tabela} where organization_id = '${GOV_ORG}';`)));
    expect(depois).toBe(antes);
    expect(depois).toBeGreaterThanOrEqual(1);
  });

  it("a linha da outra organização também fica intacta", () => {
    expect(Number(lastLine(sql(`select count(*) from public.${tabela} where organization_id = '${ORG_B}';`)))).toBeGreaterThanOrEqual(1);
  });
});

describe("as funções do dinheiro não são alcançáveis por authenticated nem por anon", () => {
  it.each([
    ["fn_emitir_fatura", "public.fn_emitir_fatura(uuid, uuid, date, date, date, text, text, jsonb)"],
    ["fn_marcar_fatura_paga", "public.fn_marcar_fatura_paga(uuid, text, text)"],
    ["fn_trocar_plano_da_organizacao", "public.fn_trocar_plano_da_organizacao(uuid, uuid, uuid, text)"],
    ["fn_tokens_de_ia_no_periodo", "public.fn_tokens_de_ia_no_periodo(uuid, timestamptz, timestamptz)"],
  ])("%s: só o servidor executa", (_nome, assinatura) => {
    for (const papel of ["anon", "authenticated", "public"]) {
      const quem = papel === "public" ? "public" : papel;
      const out = lastLine(
        sql(
          papel === "public"
            ? `select exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                              where p.oid = '${assinatura}'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE');`
            : `select has_function_privilege('${quem}', '${assinatura}'::regprocedure, 'EXECUTE');`,
        ),
      );
      expect(out, `${papel} não pode executar ${assinatura}`).toBe("f");
    }
    expect(lastLine(sql(`select has_function_privilege('service_role', '${assinatura}'::regprocedure, 'EXECUTE');`))).toBe("t");
  });
});
