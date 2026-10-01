/**
 * SonghaiCRM — `marcarRecebidasComoLidas` (lib/inbox/leitura-das-recebidas.ts)
 * escreve `messages.read_at` com o client da SESSÃO. Esta prova roda o MESMO
 * update como `authenticated`, sob a RLS real, e mede as duas metades:
 *
 *  - na própria organização, marca só as RECEBIDAS ainda não lidas (enviadas e
 *    já lidas ficam como estavam);
 *  - apontado para a conversa de OUTRA organização, não marca nada — mesmo que
 *    o filtro de `organization_id` da função fosse esquecido, a policy
 *    `messages_update` segura.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sql } from "./psql-transporte";

const ORG_A = "a0505000-0000-4000-8000-00000000000a";
const ORG_B = "b0505000-0000-4000-8000-00000000000b";
const USER_A = "a0505000-0000-4000-8000-0000000000aa";
const SESS_A = "a0505000-0000-4000-8000-0000000000a5";
const SESS_B = "b0505000-0000-4000-8000-0000000000b5";
const CT_A = "a0505000-0000-4000-8000-0000000000ac";
const CT_B = "b0505000-0000-4000-8000-0000000000bc";
const CONV_A = "a0505000-0000-4000-8000-0000000000c0";
const CONV_B = "b0505000-0000-4000-8000-0000000000c0";
const JA_LIDA = "2026-09-01T10:00:00Z";

function marcarComoUsuario(org: string, conv: string): number {
  const saida = sql(`
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${USER_A}","role":"authenticated"}', false);
    with feitas as (
      update public.messages set read_at = now()
       where organization_id = '${org}' and conversation_id = '${conv}'
         and direction = 'inbound' and read_at is null
      returning id
    )
    select 'N|' || count(*) from feitas;
    reset role;
  `);
  return Number(saida.split("\n").find((l) => l.startsWith("N|"))?.slice(2));
}

function contar(conv: string, filtro: string): number {
  const saida = sql(`select 'N|' || count(*) from public.messages where conversation_id = '${conv}' and ${filtro};`);
  return Number(saida.split("\n").find((l) => l.startsWith("N|"))?.slice(2));
}

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values ('${USER_A}', 'leitura-a@invariant.test') on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'leitura-org-a', 'Loja A', 'Loja A'),
      ('${ORG_B}', 'leitura-org-b', 'Loja B', 'Loja B')
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${USER_A}', '${ORG_A}', 'admin', now()) on conflict do nothing;
    insert into public.contacts (id, organization_id, name, phone_number) values
      ('${CT_A}', '${ORG_A}', 'Cliente A', '+258840000001'),
      ('${CT_B}', '${ORG_B}', 'Cliente B', '+258840000002')
      on conflict (id) do nothing;
    insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted, status) values
      ('${SESS_A}', '${ORG_A}', 'leitura-a', '\\x00'::bytea, 'WORKING'),
      ('${SESS_B}', '${ORG_B}', 'leitura-b', '\\x00'::bytea, 'WORKING')
      on conflict (id) do nothing;
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status) values
      ('${CONV_A}', '${ORG_A}', '${CT_A}', '${SESS_A}', 'open'),
      ('${CONV_B}', '${ORG_B}', '${CT_B}', '${SESS_B}', 'open')
      on conflict (id) do nothing;
    delete from public.messages where conversation_id in ('${CONV_A}', '${CONV_B}');
    insert into public.messages
      (organization_id, conversation_id, channel_session_id, contact_id, type, direction, status, sent_via, body, sent_at, read_at)
    values
      ('${ORG_A}', '${CONV_A}', '${SESS_A}', '${CT_A}', 'text', 'inbound',  'received',  'crm',  'Olá',        now(), null),
      ('${ORG_A}', '${CONV_A}', '${SESS_A}', '${CT_A}', 'text', 'inbound',  'received',  'crm',  'Tem stock?', now(), null),
      ('${ORG_A}', '${CONV_A}', '${SESS_A}', '${CT_A}', 'text', 'inbound',  'received',  'crm',  'Antiga',     now(), '${JA_LIDA}'),
      ('${ORG_A}', '${CONV_A}', '${SESS_A}', '${CT_A}', 'text', 'outbound', 'sent',      'user', 'Temos sim',  now(), null),
      ('${ORG_B}', '${CONV_B}', '${SESS_B}', '${CT_B}', 'text', 'inbound',  'received',  'crm',  'Bom dia',    now(), null);
  `);
});

afterAll(() => {
  sql(`
    delete from public.messages where conversation_id in ('${CONV_A}', '${CONV_B}');
    delete from public.conversations where id in ('${CONV_A}', '${CONV_B}');
    delete from public.channel_sessions where id in ('${SESS_A}', '${SESS_B}');
    delete from public.contacts where id in ('${CT_A}', '${CT_B}');
    delete from public.user_organizations where user_id = '${USER_A}';
    delete from public.organizations where id in ('${ORG_A}', '${ORG_B}');
    delete from auth.users where id = '${USER_A}';
  `);
});

describe("tiques de leitura das mensagens recebidas", () => {
  it("na própria organização marca só as recebidas ainda não lidas", () => {
    expect(marcarComoUsuario(ORG_A, CONV_A)).toBe(2);
    expect(contar(CONV_A, "direction = 'inbound' and read_at is null")).toBe(0);
    expect(contar(CONV_A, `read_at = '${JA_LIDA}'`)).toBe(1);
    expect(contar(CONV_A, "direction = 'outbound' and read_at is null")).toBe(1);
  });

  it("a segunda chamada não mexe em nada (idempotente)", () => {
    expect(marcarComoUsuario(ORG_A, CONV_A)).toBe(0);
  });

  it("a conversa de outra organização fica intocada, mesmo pedindo pelo id dela", () => {
    expect(marcarComoUsuario(ORG_B, CONV_B)).toBe(0);
    expect(contar(CONV_B, "read_at is null")).toBe(1);
  });
});
