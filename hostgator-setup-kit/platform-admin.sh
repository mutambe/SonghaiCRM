#!/usr/bin/env bash
# Administradores da PLATAFORMA (quem administra a instalação inteira), sem
# escrever SQL à mão.
#
# O ecrã Admin › Administradores da plataforma é só de consulta, de propósito:
# conceder este acesso por um botão deixaria uma sessão roubada criar outro
# administrador. A regra continua — só quem tem acesso ao SERVIDOR concede —, e
# este script é a forma segura de o fazer: valida a conta, recusa tirar o último
# administrador com acesso total e deixa a operação no registo de auditoria.
#
#   bash hostgator-setup-kit/platform-admin.sh listar
#   bash hostgator-setup-kit/platform-admin.sh adicionar <email> [total|leitura] ["motivo"]
#   bash hostgator-setup-kit/platform-admin.sh retirar   <email> ["motivo"]
#   bash hostgator-setup-kit/platform-admin.sh exigir-mfa <email> sim|nao
#
# «total» pode alterar tudo (scope full); «leitura» é o acesso de suporte, que
# só consulta (scope support_readonly). A pessoa precisa de já ter conta no CRM.
#
# Os valores vão ao psql como VARIÁVEIS (`-v email=…` e `:'email'` no SQL), nunca
# colados no texto do comando — um e-mail com aspas não vira SQL.
source "$(dirname "$0")/_common.sh"
enter_project

ACAO="${1:-}"
EMAIL="${2:-}"

uso() {
  die "Uso: platform-admin.sh listar | adicionar <email> [total|leitura] [\"motivo\"] | retirar <email> [\"motivo\"] | exigir-mfa <email> sim|nao"
}

# Uma consulta que devolve UM valor (sem cabeçalho nem espaços).
valor_sql() { psql_run -tA "$@" | tr -d '\r' | sed -n '1p' | tr -d '[:space:]'; }

exigir_email() {
  [ -n "$EMAIL" ] || uso
  printf '%s' "$EMAIL" | grep -qE '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' || die "E-mail inválido: $EMAIL"
}

# Põe em UID_ALVO o id da conta, ou morre explicando o que fazer. Sem subshell:
# um `die` dentro de $(…) só sairia do subshell, e a mensagem se perderia.
resolver_conta() {
  UID_ALVO="$(valor_sql -v email="$EMAIL" <<'SQL'
select id from auth.users where lower(email) = lower(:'email') limit 1;
SQL
)"
  printf '%s' "$UID_ALVO" | grep -qE '^[0-9a-f-]{36}$'     || die "Não há conta com o e-mail $EMAIL. A pessoa precisa de criar conta (ou ser convidada) no CRM antes."
}

case "$ACAO" in
  listar)
    step "Administradores da plataforma"
    psql_run <<'SQL'
select u.email,
       case p.scope when 'full' then 'total' when 'support_readonly' then 'leitura' else p.scope end as acesso,
       case when p.mfa_required then 'sim' else 'não' end as exige_mfa,
       case when p.revoked_at is null then 'activo' else 'retirado' end as estado,
       to_char(p.granted_at at time zone 'Africa/Maputo', 'DD/MM/YYYY HH24:MI') as desde,
       p.reason as motivo
from public.platform_admins p
left join auth.users u on u.id = p.user_id
order by p.revoked_at is not null, p.granted_at;
SQL
    ;;

  adicionar)
    exigir_email
    case "${3:-total}" in
      total) SCOPE=full ;;
      leitura) SCOPE=support_readonly ;;
      *) die "Acesso desconhecido: ${3}. Use «total» ou «leitura»." ;;
    esac
    MOTIVO="${4:-Concedido pelo servidor (platform-admin.sh)}"
    resolver_conta
    c_ylw "Isto dá a $EMAIL acesso de administrador da PLATAFORMA (${3:-total}) — todas as organizações desta instalação."
    read -r -p "Confirmar? (s/N) " a; resposta_sim "$a" || die "Cancelado."
    step "Concedendo"
    psql_run -v uid="$UID_ALVO" -v scope="$SCOPE" -v motivo="$MOTIVO" -v email="$EMAIL" <<'SQL'
insert into public.platform_admins (user_id, granted_by, scope, mfa_required, reason)
values (:'uid', :'uid', :'scope', false, :'motivo')
on conflict (user_id) do update
   set scope = excluded.scope, reason = excluded.reason, granted_at = now(),
       revoked_at = null, revoked_by = null, revoke_reason = null;
insert into public.api_audit_log (actor_user_id, acting_as_platform_admin, action, resource_type, resource_id, bypassed_rls, metadata)
values (null, true, 'platform_admin.granted_by_operator', 'platform_admin', :'uid', true,
        jsonb_build_object('email', :'email', 'scope', :'scope', 'motivo', :'motivo', 'via', 'platform-admin.sh'));
SQL
    c_grn "✓ $EMAIL é administrador da plataforma. Ela vê o menu Admin no próximo carregamento da página."
    ;;

  retirar)
    exigir_email
    MOTIVO="${3:-Retirado pelo servidor (platform-admin.sh)}"
    resolver_conta
    ATIVO="$(valor_sql -v uid="$UID_ALVO" <<'SQL'
select count(*) from public.platform_admins where user_id = :'uid' and revoked_at is null;
SQL
)"
    [ "$ATIVO" = "1" ] || die "$EMAIL não é administrador activo da plataforma."
    OUTROS_TOTAIS="$(valor_sql -v uid="$UID_ALVO" <<'SQL'
select count(*) from public.platform_admins
 where revoked_at is null and scope = 'full' and user_id <> :'uid';
SQL
)"
    [ "${OUTROS_TOTAIS:-0}" -gt 0 ] \
      || die "Recusado: $EMAIL é o ÚLTIMO administrador com acesso total. Adicione outro antes de retirar este — senão ninguém administra a instalação pelo ecrã."
    c_ylw "Isto retira o acesso de administrador da plataforma de $EMAIL."
    read -r -p "Confirmar? (s/N) " a; resposta_sim "$a" || die "Cancelado."
    step "Retirando"
    psql_run -v uid="$UID_ALVO" -v motivo="$MOTIVO" -v email="$EMAIL" <<'SQL'
update public.platform_admins
   set revoked_at = now(), revoked_by = user_id, revoke_reason = :'motivo'
 where user_id = :'uid' and revoked_at is null;
insert into public.api_audit_log (actor_user_id, acting_as_platform_admin, action, resource_type, resource_id, bypassed_rls, metadata)
values (null, true, 'platform_admin.revoked_by_operator', 'platform_admin', :'uid', true,
        jsonb_build_object('email', :'email', 'motivo', :'motivo', 'via', 'platform-admin.sh'));
SQL
    c_grn "✓ Acesso retirado. A conta de $EMAIL continua a existir; só deixa de administrar a plataforma."
    ;;

  exigir-mfa)
    exigir_email
    case "${3:-}" in
      sim) EXIGE=true ;;
      nao|não) EXIGE=false ;;
      *) uso ;;
    esac
    resolver_conta
    step "Gravando a exigência de verificação em dois passos"
    psql_run -v uid="$UID_ALVO" -v exige="$EXIGE" -v email="$EMAIL" <<'SQL'
update public.platform_admins set mfa_required = :'exige'::boolean
 where user_id = :'uid' and revoked_at is null;
insert into public.api_audit_log (actor_user_id, acting_as_platform_admin, action, resource_type, resource_id, bypassed_rls, metadata)
values (null, true, 'platform_admin.mfa_policy_changed_by_operator', 'platform_admin', :'uid', true,
        jsonb_build_object('email', :'email', 'mfa_required', :'exige'::boolean, 'via', 'platform-admin.sh'));
SQL
    if [ "$EXIGE" = true ]; then
      c_grn "✓ $EMAIL passa a ter de configurar a verificação em dois passos ao entrar."
    else
      c_grn "✓ A verificação em dois passos deixa de ser obrigatória para $EMAIL (quem já a tem continua a usá-la)."
    fi
    ;;

  *) uso ;;
esac
