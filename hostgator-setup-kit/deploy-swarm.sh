#!/usr/bin/env bash
# SonghaiCRM — instala ou atualiza o stack em Docker SWARM (Portainer + Traefik).
#
#   bash hostgator-setup-kit/deploy-swarm.sh                  # última versão publicada
#   bash hostgator-setup-kit/deploy-swarm.sh 1.70.0           # uma versão escolhida
#   bash hostgator-setup-kit/deploy-swarm.sh --so-banco 1.70.0
#        só o backup e o banco — para quem troca as imagens pelo Portainer
#
# Variáveis opcionais: STACK (padrão `songhaicrm` — o nome do stack no
# Portainer; mudar de nome cria volumes NOVOS e perde as sessões do WhatsApp),
# SKIP_BACKUP=1.
#
# ═══ A ORDEM É O PRODUTO ═══
#
#   backup → código na tag da versão → BANCO → imagens da MESMA versão → saúde
#
# O fork pagou em produção (2026-09-06) a ordem contrária: as imagens foram
# trocadas sem o banco, o código novo gravava um valor que o schema antigo
# recusava, e o erro sumia no log. O banco vai pela MESMA função do update.sh
# (`reaplicar_baseline`: baseline.sql + songhai.sql numa chamada, com as
# re-passadas por disputa), e as três imagens vão pinadas na versão, nunca num
# canal móvel (docs/doctrine/packaging.md).
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck source=_common.sh
source "$KIT_DIR/_common.sh"

SO_BANCO=""
VERSAO=""
for arg in "$@"; do
  case "$arg" in
    --so-banco) SO_BANCO=1 ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    -*) die "opção desconhecida: $arg (veja --help)" ;;
    *) VERSAO="${arg#v}" ;;
  esac
done
STACK="${STACK:-songhaicrm}"
COMPOSE="docker-compose.swarm.yml"

enter_project
command -v docker >/dev/null 2>&1 || die "docker não encontrado neste servidor."
if [ -z "$SO_BANCO" ]; then
  [ "$(docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null)" = "active" ] \
    || die "Este servidor não está num Docker Swarm ativo. Para a instalação comum use o update.sh."
  [ "$(docker info --format '{{.Swarm.ControlAvailable}}' 2>/dev/null)" = "true" ] \
    || die "Rode num nó MANAGER do Swarm (é ele que aceita o stack deploy)."
  docker network inspect "${TRAEFIK_NETWORK_SWARM:-traefik_public}" >/dev/null 2>&1 \
    || die "A rede do Traefik '${TRAEFIK_NETWORK_SWARM:-traefik_public}' não existe. Ponha o nome certo em TRAEFIK_NETWORK_SWARM no .env."
  [ -n "${DOMAIN:-}" ] || die "DOMAIN está vazio no .env."
fi

# ── 1. Qual versão ───────────────────────────────────────────────────────────
step "Versão"
git fetch --tags --quiet origin 2>/dev/null || c_ylw "⚠ não consegui falar com o GitHub — sigo com as tags que já estão aqui."
# A AUTORIDADE é a release publicada, não a maior tag — a mesma régua do update.sh.
[ -n "$VERSAO" ] || { VERSAO="$(ultima_release_estavel)"; VERSAO="${VERSAO#v}"; }
[ -n "$VERSAO" ] || die "Não consegui descobrir a última versão publicada. Diga qual: deploy-swarm.sh 1.70.0"
git rev-parse --quiet --verify "refs/tags/v$VERSAO" >/dev/null || die "A versão v$VERSAO não existe neste repositório."
c_grn "✓ alvo: v$VERSAO (stack '$STACK')"

# ── 2. Backup do banco ANTES de tocar nele ──────────────────────────────────
# O dump é o do backup.sh (mesma conexão de schema, mesmo `.parcial` + gzip -t).
# O backup.sh inteiro não serve aqui: ele acha o volume do WhatsApp pelo
# `docker compose`, que num stack não existe. As sessões não mudam numa
# atualização — o volume `${STACK}_waha-data` fica onde está.
if [ -z "${SKIP_BACKUP:-}" ]; then
  step "Backup do banco"
  BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
  mkdir -p "$BACKUP_DIR"
  ts="$(date +%Y%m%d-%H%M%S)"
  parcial="$BACKUP_DIR/.db-$ts.sql.gz.parcial"
  if ! pg_container postgres:17-alpine pg_dump "$(url_do_schema)" --no-owner --no-privileges | gzip > "$parcial"; then
    rm -f "$parcial"
    die "o dump do banco falhou — não mexi em nada. Sem backup válido, não sigo."
  fi
  gzip -t "$parcial" 2>/dev/null || { rm -f "$parcial"; die "o dump saiu corrompido — não mexi em nada."; }
  mv "$parcial" "$BACKUP_DIR/db-$ts.sql.gz"
  c_grn "✓ backup: $BACKUP_DIR/db-$ts.sql.gz"
fi

# ── 3. Código na tag da versão ──────────────────────────────────────────────
# O baseline.sql e o songhai.sql que vão para o banco são os DESTA versão.
step "Código da v$VERSAO"
[ -z "$(git status --porcelain --untracked-files=no)" ] \
  || die "Há alterações locais nos arquivos do projeto (git status). Resolva antes — não mexi no banco."
git checkout --quiet "v$VERSAO" || die "Não consegui trocar para v$VERSAO. Não mexi no banco."
# As funções do kit da versão NOVA (o mesmo motivo da releitura no update.sh).
# shellcheck source=_common.sh
source "$KIT_DIR/_common.sh"
COMPOSE="docker-compose.swarm.yml"   # o _common.sh relido volta ao compose padrão
c_grn "✓ código em v$VERSAO"

# ── 4. Banco ────────────────────────────────────────────────────────────────
step "Banco (baseline.sql + songhai.sql)"
if reaplicar_baseline "$PROJECT_DIR/supabase/baseline.sql" "$PROJECT_DIR/.deskcomm-banco.log"; then
  c_grn "✓ banco na v$VERSAO"
else
  c_red "✖ o banco não fechou limpo. Não troquei as imagens: o app continua na versão anterior."
  listar_erros_do_banco "${BASELINE_INESPERADO:-}" 10 "    "
  die "Detalhes em $PROJECT_DIR/.deskcomm-banco.log. Corrija e rode de novo (é seguro repetir)."
fi

if [ -n "$SO_BANCO" ]; then
  c_grn "Pronto: banco na v$VERSAO. Agora troque as imagens para a tag $VERSAO no Portainer."
  exit 0
fi

# ── 5. Imagens da MESMA versão ──────────────────────────────────────────────
step "Stack '$STACK' na v$VERSAO"
gravar_imagens .env "$VERSAO"
load_env .env
export APP_IMAGE WORKER_IMAGE SCHEDULER_IMAGE
# `docker stack deploy` não lê o .env sozinho para interpolar `${DOMAIN}` e
# afins: o `load_env` acima exportou tudo.
#
# Os serviços recebem as variáveis por `env_file` (SWARM_ENV_FILE) — mas NÃO
# o .env do kit diretamente. O instalador grava os valores entre aspas
# (`NEXT_PUBLIC_APP_URL="https://…"`, ver `envq`), e o `env_file` do
# `docker stack deploy`, ao contrário do `docker compose`, NÃO tira as aspas:
# todo valor chegava ao contêiner com elas, e o app recusava no arranque
# ("NEXT_PUBLIC_ADMIN_URL: Invalid URL"). Medido na primeira instalação
# SonghaiCRM 2.0.0 em Swarm (2026-10-02). `.env.swarm` é o .env já DECODIFICADO
# pelo `load_env` (aspas e escapes desfeitos), uma linha KEY=valor por variável,
# com o mesmo rigor de permissão do .env.
ENV_SWARM="$PROJECT_DIR/.env.swarm"
( umask 077; : > "$ENV_SWARM" )
while IFS= read -r linha || [ -n "$linha" ]; do
  chave="${linha%%=*}"
  case "$chave" in ''|*[!A-Za-z0-9_]*) continue ;; esac
  [ "$chave" != "$linha" ] || continue
  valor="${!chave-}"
  case "$valor" in *$'\n'*) continue ;; esac   # env_file não carrega valor multilinha
  printf '%s=%s\n' "$chave" "$valor" >> "$ENV_SWARM"
done < .env
SWARM_ENV_FILE=.env.swarm docker stack deploy \
  -c "$COMPOSE" --with-registry-auth --resolve-image always "$STACK" \
  || die "O docker stack deploy falhou (acima). O banco já está na v$VERSAO; é seguro repetir."

# ── 6. Saúde ────────────────────────────────────────────────────────────────
step "Conferindo"
docker stack services "$STACK" --format '{{.Name}}\t{{.Replicas}}\t{{.Image}}'
code="000"
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
  code="$(curl -sk -o /dev/null -w '%{http_code}' "https://${DOMAIN}/" --max-time 10 || echo 000)"
  [ "$code" = "307" ] && break
  sleep 10
done
if [ "$code" = "307" ]; then
  c_grn "✓ https://${DOMAIN}/ responde 307 (vai para o login) — SonghaiCRM na v$VERSAO."
else
  c_ylw "⚠ https://${DOMAIN}/ respondeu $code (o esperado é 307)."
  c_ylw "  404 costuma ser o Traefik sem enxergar o serviço: confira TRAEFIK_NETWORK_SWARM,"
  c_ylw "  TRAEFIK_ENTRYPOINT e TRAEFIK_CERTRESOLVER no .env, e 'docker service logs ${STACK}_app'."
  exit 1
fi
