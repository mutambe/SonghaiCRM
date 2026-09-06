#!/usr/bin/env bash
# Deploy para instalações em Docker SWARM que rastreiam a tag :latest (topo da
# main) em vez do fluxo padrão do kit (docker compose + tag de release via
# update.sh — ver docs/doctrine/packaging.md). É o caso de instalações onde o
# stack roda via `docker service`/`docker stack deploy`, não `docker compose`,
# e APP_IMAGE/WORKER_IMAGE/SCHEDULER_IMAGE no .env apontam pra `:latest`.
#
# ⚠️ POR QUE ESTE SCRIPT EXISTE — causa raiz medida em produção (2026-09-06):
# um deploy de código (`docker service update --force`) rodou atualizando só as
# IMAGENS, sem tocar no banco. Uma migration nova (0175, valor novo em
# `agent_inbox_items.kind`) nunca chegou ao Postgres — o código novo tentava
# gravar um aviso que o banco recusava com 23514 (constraint check), engolido
# em silêncio (catch + log.error, doutrina de "nunca derruba o turno"). O
# sintoma na ponta: o retry automático funcionava, mas o aviso na Central
# nunca aparecia, e ninguém percebeu até investigar log a log. Um comando único
# que sempre aplica banco ANTES de trocar imagem elimina essa classe de bug —
# código e schema andam sempre juntos, nunca um passo manual esquecível.
#
# Uso:
#   cd /caminho/da/instalação && bash self-host-kit/deploy-swarm-latest.sh
#
# Pré-requisitos (não verificados por magia — o script falha alto se faltar):
#   - .env com SUPABASE_DB_URL, APP_IMAGE/WORKER_IMAGE/SCHEDULER_IMAGE, DOMAIN
#   - stack do Swarm já no ar com os serviços <projeto>_app/_worker/_scheduler
#     (o nome do projeto vem do 1º argumento; default 'songhaicrm')
#   - checkout local limpo, sem commits próprios à frente de origin/main —
#     um fork com trabalho não commitado para AQUI, não avança sozinho.

set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"

STACK="${1:-songhaicrm}"

step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$1"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$1"; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

[ -f .env ] || die "Rode a partir do diretório da instalação (.env não encontrado aqui)."
set -a
# shellcheck disable=SC1091
source .env
set +a
[ -n "${SUPABASE_DB_URL:-}" ] || die "SUPABASE_DB_URL vazio no .env — não dá pra aplicar o schema."

step "1/5 Sincronizando código (git fetch + fast-forward de origin/main)"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  die "Working tree suja (git status). Resolva ou faça stash antes — não avanço em cima de trabalho não commitado."
fi
git fetch --quiet origin main
git checkout --quiet main
git merge --ff-only origin/main \
  || die "'main' local tem commits próprios à frente de origin/main — resolva manualmente (não é fast-forward)."
ok "código em $(git rev-parse --short HEAD)"

step "2/5 Aplicando schema no banco (baseline.sql — idempotente, mesma receita do install.sh/update.sh)"
[ -f supabase/baseline.sql ] || die "supabase/baseline.sql não encontrado no checkout."
docker run --rm -i -v "$(pwd)/supabase/baseline.sql:/baseline.sql:ro" \
  postgres:17-alpine psql "$SUPABASE_DB_URL" -f /baseline.sql
ok "banco sincronizado"

step "3/5 Baixando as imagens :latest publicadas"
APP_IMAGE="${APP_IMAGE:-ghcr.io/mutambe/deskcommcrm:latest}"
WORKER_IMAGE="${WORKER_IMAGE:-ghcr.io/mutambe/deskcomm-worker:latest}"
SCHEDULER_IMAGE="${SCHEDULER_IMAGE:-ghcr.io/mutambe/deskcomm-scheduler:latest}"
docker pull "$APP_IMAGE"
docker pull "$WORKER_IMAGE"
docker pull "$SCHEDULER_IMAGE"

step "4/5 Atualizando os serviços do Swarm (--force repuxa o :latest recém-baixado)"
docker service update --image "$APP_IMAGE" --with-registry-auth --force "${STACK}_app"
docker service update --image "$WORKER_IMAGE" --with-registry-auth --force "${STACK}_worker"
docker service update --image "$SCHEDULER_IMAGE" --with-registry-auth --force "${STACK}_scheduler"

step "5/5 Checando saúde"
sleep 5
docker ps --filter "name=${STACK}_app" --filter "name=${STACK}_worker" --filter "name=${STACK}_scheduler" \
  --format '{{.Names}}\t{{.Status}}'
if [ -n "${DOMAIN:-}" ]; then
  code="$(curl -sk -o /dev/null -w '%{http_code}' "https://${DOMAIN}/" --max-time 15 || echo '000')"
  if [ "$code" = "307" ]; then
    ok "https://${DOMAIN}/ respondeu 307 (redireciona pro login, como esperado)"
  else
    warn "https://${DOMAIN}/ respondeu ${code} — confira antes de dar como concluído (307 é o esperado; 404 costuma ser proxy sem as labels certas — ver docs/runbooks/deploy.md)."
  fi
fi
