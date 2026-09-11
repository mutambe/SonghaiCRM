# Runbook — Deploy em produção (VPS)

O caminho normal de deploy **não constrói nada na VPS**: o CI publica a imagem no
GHCR e a VPS só puxa. Construir localmente é exceção de emergência, e tem custo —
está documentado no fim.

---

## 1. O comando

```bash
cd /var/www/crm
docker compose -f docker-compose.prod.yml -f docker-compose.traefik.yml --env-file .env up -d app
```

### Os DOIS `-f` são obrigatórios. Sempre.

Esta é a pegadinha que já derrubou o site inteiro em produção (2026-08-05).

A VPS (Hostinger) vem com um **Traefik próprio** ocupando as portas 80/443.
`docker-compose.traefik.yml` é o ÚNICO lugar que:

- coloca no contêiner `app` as labels de roteamento
  (`traefik.http.routers.deskcomm.rule=Host(...)`);
- associa o contêiner à rede que o Traefik enxerga (`TRAEFIK_DOCKER_NETWORK`);
- desliga o `caddy` do compose base por profile (senão dois processos brigam
  pela mesma porta).

Rodar só com `-f docker-compose.prod.yml` recria o contêiner **sem labels
nenhuma**. O Traefik deixa de enxergá-lo e o domínio inteiro passa a responder
`404 page not found` — não é erro do Next, é o 404 genérico do Traefik. A app
está no ar, saudável, e inalcançável.

---

## 2. Verificação pós-deploy (não pule)

`healthy` no `docker ps` **não prova que o site está acessível** — o healthcheck
é um probe TCP interno e passa mesmo com o roteamento quebrado. Verifique as
duas coisas:

```bash
# 1) as labels do Traefik existem?
#    O nome do contêiner é <pasta-do-projeto>-app-1, então pergunte ao compose
#    em vez de chutar. Aqui um -f só basta: o `ps -q` resolve pelo nome do
#    projeto + serviço, não pelo conteúdo do arquivo (medido: com um -f ou com
#    os dois, devolve o MESMO contêiner). Quem precisa dos dois é o `up -d`.
docker inspect "$(docker compose -f docker-compose.prod.yml ps -q app)" \
  --format '{{.Config.Labels}}' | grep -o 'traefik.enable:[^ ]*'
# esperado: traefik.enable:true   (vazio = roteamento quebrado)

# 2) o domínio responde?
curl -s -o /dev/null -w "%{http_code}\n" https://<DOMAIN>/
# esperado: 307 (redireciona pro login)
# 404      = labels perdidas, refaça o deploy com os dois -f
```

---

## 3. Fluxo completo (do código à produção)

```
commit → push → PR → merge na main → CI publica imagem → VPS puxa
```

1. **Commit + push** numa branch de feature. Trabalho que fica só no disco da
   VPS não existe: o CI não o vê, some se a VPS for reconstruída, e é invisível
   pra qualquer outra pessoa.
2. **PR e merge na `main`.** `publish-image.yml` dispara em push na `main` (ou
   tag `v*`) e publica **três** imagens — `deskcommcrm`, `deskcomm-worker` e
   `deskcomm-scheduler` — sempre na mesma versão. O build pesado roda nos
   runners do GitHub, nunca na VPS do usuário.
3. **Deploy na VPS.** Numa instalação real isto é `bash self-host-kit/update.sh`,
   não um `up -d` na mão: ele puxa a tag publicada, re-aplica o `baseline.sql`,
   faz backup antes e grava as três imagens no `.env`.

> **`latest` não é a última release.** Ele é publicado a partir da branch default, então
> segue o **topo da `main`** — código ainda não lançado. Quem quer a última release usa
> `stable`; quem opera um cliente usa o número da versão. Ver
> [`../doctrine/packaging.md`](../doctrine/packaging.md).

---

## 4. Exceção: imagem construída na VPS

Só quando é preciso validar algo em produção **antes** de a imagem oficial
existir (ex.: CI ainda rodando e um bug bloqueando o usuário).

```bash
APP_IMAGE=deskcomm-app:local docker compose \
  -f docker-compose.prod.yml -f docker-compose.build.yml --env-file .env build app

APP_IMAGE=deskcomm-app:local APP_PULL_POLICY=never docker compose \
  -f docker-compose.prod.yml -f docker-compose.traefik.yml --env-file .env up -d app
```

O `docker-compose.build.yml` também cobre `worker` e `scheduler` — troque
`app` pelo serviço que você precisa construir. Eles têm `build:` no próprio
compose de produção (é o escape que faz a instalação sobreviver a um registry
fora do ar), mas é o override que traz o `pull_policy: never`; sem ele o
`up -d` volta a buscar a imagem publicada.

**Isto é dívida, não um caminho paralelo.** A imagem existe só no disco daquela
VPS: não está no registry, não está no git, e qualquer `docker compose up -d`
sem `APP_PULL_POLICY=never` a substitui pela do GHCR — silenciosamente, sem erro
nenhum, revertendo o que você acabou de subir.

Requisitos: >= 4 GB de RAM **ou** swap (medido: ~4min num VPS de 3.8 GB com 4 GB
de swap) — e isto é o requisito **deste caminho de exceção**, não da operação
normal. A régua de operação é outra, e não mudou. Ela tem três parcelas, e **duas
são medidas e uma é herdada** — a distinção importa porque a herdada é a que
costuma ser citada como se fosse nossa:

| parcela | estado | como conferir |
|---|---|---|
| 7 contêineres | **medido** | `docker compose -f docker-compose.prod.yml config --services \| wc -l` |
| `mem_limit` somando 2560m (app 768 + worker 512 + waha 1280) | **medido** | `grep -n 'mem_limit' docker-compose.prod.yml` |
| ~150 MB por número de WhatsApp | **herdado do upstream WAHA**, nunca medido neste projeto | `docker stats --no-stream` na sua VPS |

O terceiro número vem de `docs/research/reference-synthesis.md` (síntese do curso
WAHA, 2026-05), não de uma medição nossa — e circula em sete documentos que se
citam entre si. Uma medição pontual na produção do projeto (2026-08-14, **uma**
sessão pareada, VPS compartilhada com outras stacks) deu **304,5 MiB no contêiner
`waha` inteiro**, contra o `mem_limit` de 1280 MiB. Um ponto não decompõe baseline
e sessão: para isso seriam necessários dois números pareados, e não é ensaio que
se faça numa instalação viva.

**Nada disso mexe no tier recomendado.** A régua que sustenta os 4 GB é a soma da
stack em operação, não o WAHA isolado — e a folga existe justamente porque a
parcela por sessão não é conhecida com precisão.

Ao terminar, feche o ciclo — merge na `main` e volte a VPS pra imagem oficial.

---

## 5. Pendência aberta (2026-09-07) — dívida deste caminho de exceção em produção

**Contexto:** `verify`/`invariants`/`build-and-push`/`e2e`/`imagens-ok` do PR #11
(mutambe/SonghaiCRM) não rodaram — GitHub Actions bloqueado por falha de
pagamento/limite de gasto na conta (todos os jobs recusados antes de começar,
não é falha de código). PR mergeado na `main` (commit `5e02f60c`) com
`--admin` (bypass de branch protection), aprovado explicitamente pelo dono do
produto, com verificação local manual (typecheck + lint + testes unitários
tocados, todos verdes) no lugar do CI — `pnpm test:db` (RLS) e `pnpm test:e2e`
**não** rodaram.

A VPS de produção (`crm.songhai.ltd`, Docker Swarm, stack `songhaicrm`) não
usa `docker compose` (o caminho documentado acima) — usa
`self-host-kit/deploy-swarm-latest.sh`, que puxa `:latest` do GHCR. Como o
`publish-image.yml` também está bloqueado pelo mesmo billing, a tag `:latest`
no registry **não tem** o commit `5e02f60c`. Deploy feito manualmente,
adaptando a exceção da seção 4 pro Swarm: `docker build` local das 3 imagens
(`deskcomm-app:local`, `deskcomm-worker:local`, `deskcomm-scheduler:local`) e
`docker service update --image <tag>:local --force songhaicrm_<serviço>` —
sem tocar em `.env` (que continua apontando pra `ghcr.io/mutambe/...:latest`).
Schema **não** foi reaplicado (`baseline.sql`) — esta mudança não tem
migration, então não era necessário.

**Tarefa pendente — fechar o ciclo assim que o billing do GitHub for resolvido:**

- [ ] Resolver o billing (Settings → Billing & plans da conta/org `mutambe`).
- [ ] Re-disparar o CI do commit `5e02f60c` (ou empurrar um commit trivial)
      e confirmar os 5 checks obrigatórios verdes — cobre agora o que o
      merge manual pulou (`test:db`/RLS, `e2e`).
- [ ] Confirmar que `publish-image.yml` publicou as 3 imagens em `:latest`.
- [ ] Na VPS: `cd /root/songhaicrm && bash self-host-kit/deploy-swarm-latest.sh`
      — isso troca `deskcomm-app:local`/`-worker:local`/`-scheduler:local`
      pela imagem oficial do GHCR, fechando a dívida. **Sem este passo, um
      `docker service update --force` futuro sem `--image` reaplica a imagem
      local em vez da oficial** (Swarm não sabe que ela é "provisória").

---

## 7. Deploy manual de 2026-09-11 — PR #14 + retenção da fila/auditoria + wallpaper do Inbox

Mesma causa raiz da seção 5/6: billing do GitHub bloqueado impede CI e merge
normal. Três branches integradas manualmente e levadas à VPS SEM passar por
`main`, porque o dono do produto pediu para não esperar o billing:

- `feat/gerir-tenant-editar-deletar-resetar-acesso` (PR #14, `a1ee89e7`) —
  editar/deletar/gerir acesso do responsável de um tenant no admin.
- `worktree-retencao-fila-e-auditoria` (`21947876`, não tem PR — branch só
  empurrada pro GitHub pra a VPS conseguir buscá-la) — poda de `job_queue` +
  expurgo de `api_audit_log` (migration `0177`), 4 rotas de cron antigas
  passam a auditar só quando houve efeito.
- `feat/inbox-wallpaper-whatsapp` (PR #15, `7752ec18`) — fundo do Inbox com
  padrão de doodles próprio, tons do WhatsApp, claro e escuro.

**Achado durante a integração:** outra sessão tinha, no mesmo checkout
compartilhado, uma migration NÃO commitada também numerada `0177`
(`catalogo_groq`). Resolvido por aviso direto entre sessões — a outra
renumerou para `0178` antes de commitar. Registrado aqui porque é o tipo de
colisão que só aparece quando duas sessões trabalham a mesma branch ao mesmo
tempo; não há gate automático pra isto.

**Como foi feito** (worktree isolado `/root/songhaicrm-deploy-tmp`, removido
depois — o checkout principal `/root/songhaicrm` nunca foi tocado):

```bash
cd /root/songhaicrm
git fetch origin +refs/heads/<branch>:refs/remotes/origin/<branch>   # 3x
git worktree add -b deploy-integracao-2026-09-11 /root/songhaicrm-deploy-tmp origin/main
cd /root/songhaicrm-deploy-tmp
git merge --no-edit origin/feat/gerir-tenant-editar-deletar-resetar-acesso   # fast-forward
git merge --no-edit origin/worktree-retencao-fila-e-auditoria               # 1 conflito trivial em lib/audit/actions.ts, auto-merge
git merge --no-edit origin/feat/inbox-wallpaper-whatsapp                    # limpo

# imagens (só app e scheduler mudaram — worker não tem diff em nenhuma das 3 branches)
APP_IMAGE=deskcomm-app:local APP_VERSION=<sha> docker compose -f docker-compose.prod.yml -f docker-compose.build.yml --env-file /root/songhaicrm/.env build app
APP_IMAGE=deskcomm-scheduler:local APP_VERSION=<sha> docker compose -f docker-compose.prod.yml -f docker-compose.build.yml --env-file /root/songhaicrm/.env build scheduler
# (o compose ignora APP_IMAGE pro scheduler — a var certa é SCHEDULER_IMAGE;
#  a imagem saiu com o nome default e foi re-taggeada: docker tag ghcr.io/mutambe/deskcomm-scheduler:latest deskcomm-scheduler:local)

docker service update --image deskcomm-app:local --with-registry-auth --force songhaicrm_app
docker service update --image deskcomm-scheduler:local --with-registry-auth --force songhaicrm_scheduler

# migration 0177 — mesmo mecanismo do update.sh oficial (linha 131 do script)
set -a; source /root/songhaicrm/.env; set +a
docker run --rm postgres:17-alpine psql "$SUPABASE_DB_URL" -c "create extension if not exists vector with schema public; create extension if not exists citext with schema public; create extension if not exists pg_trgm with schema public;"
docker run --rm -i -v "$(pwd)/supabase/baseline.sql:/b.sql:ro" postgres:17-alpine psql "$SUPABASE_DB_URL" -f /b.sql

git worktree remove /root/songhaicrm-deploy-tmp --force
```

**Verificado:** os dois serviços `converged` e `healthy`; `curl` no domínio
devolve `307`; `fn_podar_fila_de_jobs`/`fn_expurgar_auditoria_vencida` existem
e `has_function_privilege` confirma `service_role` pode executar e `anon` não.

**O que NÃO foi provado antes deste deploy:** `pnpm test:db` nunca correu com
sucesso contra a migration `0177` — o ambiente do agente que a implementou não
tinha Docker. Risco aceite conscientemente (a migration só adiciona
função/índice, não remove nada) — mas fica registrado que a prova de
idempotência install+update do `baseline.sql` continua em falta pra esta
migration especificamente.

**Tarefa pendente — igual à seção 5/6, agora com 3 branches em vez de 1:**

- [ ] Resolver o billing do GitHub.
- [ ] Mergear PR #14 e PR #15 na `main` (a retenção não tem PR — abrir uma a
      partir de `worktree-retencao-fila-e-auditoria` antes, ou mergear direto).
- [ ] Confirmar os 5 checks obrigatórios verdes nos merges — cobre `test:db`
      (a lacuna acima) e `e2e`, que este deploy manual pulou.
- [ ] Rodar `pnpm test:db` explicitamente antes ou durante o merge da
      retenção — é o único gate que ainda não tocou a migration `0177`.
- [ ] Na VPS: `bash self-host-kit/deploy-swarm-latest.sh` pra trocar as
      imagens `:local` pelas oficiais do GHCR, fechando a dívida (mesmo aviso
      da seção 5: sem isto, um `--force` futuro sem `--image` reaplica a local).

