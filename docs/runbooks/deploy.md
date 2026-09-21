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

## 6. Pendência aberta (2026-09-11) — PR #14 (gestão de tenant: editar/deletar/responsável), fora do ciclo normal por DOIS motivos empilhados

**Contexto:** PR #14 (mutambe/SonghaiCRM, branch
`feat/gerir-tenant-editar-deletar-resetar-acesso`, commit `b1b1eb81`) tem os
mesmos 5 checks bloqueados pelo billing (§5) — **ainda não foi mergeado na
`main`**, ao contrário do PR #11. O dono do produto pediu deploy direto na VPS
antes do merge ("pular o GitHub, mergear depois"), então esta dívida tem uma
camada a mais que a do PR #11: nem o código está na `main` ainda.

**O que foi preparado, sem tocar em nada que já roda:**
- `git fetch origin feat/gerir-tenant-editar-deletar-resetar-acesso` executado
  na VPS.
- `git worktree add /root/songhaicrm-deploy-tmp <FETCH_HEAD>` — checkout
  isolado do commit `b1b1eb81`, em `/root/songhaicrm-deploy-tmp`. O checkout
  principal (`/root/songhaicrm`) continua limpo, na `main`, sem mudança
  nenhuma.

**Onde parou:** o ambiente de execução deste agente (Claude Code, modo
automático) bloqueou os dois comandos seguintes — `docker compose build` e
`docker service update` contra a VPS de produção — por política de sandbox
que não é contornável por confirmação na conversa. Nenhuma imagem nova foi
construída; o serviço `songhaicrm_app` continua rodando exatamente o que
rodava antes desta entrada (`deskcomm-app:local` do ciclo do PR #11, §5).

**Tarefa pendente — dois caminhos independentes, faça qualquer um:**

- [ ] **Fechar via billing** (o caminho limpo, cobre também a dívida do §5):
      resolver o billing, mergear o PR #14 normal (com os 5 checks verdes),
      e então `bash self-host-kit/deploy-swarm-latest.sh` — troca as 3
      imagens `:local` (deste PR e do #11) pelas oficiais do GHCR numa
      tacada só.
- [ ] **Fechar via build manual** (se precisar validar antes do billing
      resolver): a partir de `/root/songhaicrm-deploy-tmp` (já com o commit
      `b1b1eb81` pronto),
      ```bash
      cd /root/songhaicrm-deploy-tmp
      APP_IMAGE=deskcomm-app:local APP_VERSION=b1b1eb81 docker compose \
        -f docker-compose.prod.yml -f docker-compose.build.yml \
        --env-file /root/songhaicrm/.env build app
      docker service update --image deskcomm-app:local \
        --with-registry-auth --force songhaicrm_app
      ```
      Depois, verificar com `docker ps` + `curl -o /dev/null -w '%{http_code}' https://crm.songhai.ltd/` (esperado 307). **Isto não fecha a
      dívida** — só faz o código chegar à VPS; o merge do PR #14 na `main`
      continua pendente separadamente, e o worktree em
      `/root/songhaicrm-deploy-tmp` deve ser removido (`git worktree remove`)
      depois de usado, pra não confundir uma sessão futura sobre qual
      checkout é a fonte da verdade.

---

## 8. Deploy manual de 2026-09-12 — fecha o §6/§7: catálogo de modelos (Groq/NVIDIA/DeepSeek/Qwen/Zhipu) + integra retenção (0177) e wallpaper (PR #15)

Mesma causa raiz (billing do GitHub bloqueado, CI falha em ~5s antes de
começar). PR #14 ganhou um commit novo (`c37ff954`) com o fix do catálogo de
modelos "manuais" (`ModelPicker.tsx` mostrava "Nenhum modelo disponível" pra
Groq/NVIDIA/DeepSeek/Qwen/Zhipu/Moonshot — cada um sem seed em `ai_models`).

**Achado antes de tocar na VPS:** as migrations novas estavam numeradas
0177/0178/0179 no checkout local, colidindo com a `0177_poda_da_fila_e_
expurgo_do_audit` já deployada pela seção 7 (branch
`worktree-retencao-fila-e-auditoria`, ainda não mergeada na `main`).
Renumeradas para 0178/0179/0180 antes de qualquer coisa chegar à VPS.

**Execução** (worktree isolado `/root/songhaicrm-deploy-tmp`, removido depois
— `/root/songhaicrm` nunca tocado, ficou parado em `main`):

```bash
cd /root/songhaicrm
git fetch origin +refs/heads/feat/gerir-tenant-editar-deletar-resetar-acesso:refs/remotes/origin/feat/gerir-tenant-editar-deletar-resetar-acesso \
                 +refs/heads/worktree-retencao-fila-e-auditoria:refs/remotes/origin/worktree-retencao-fila-e-auditoria \
                 +refs/heads/feat/inbox-wallpaper-whatsapp:refs/remotes/origin/feat/inbox-wallpaper-whatsapp
git worktree add -b deploy-integracao-2026-09-12 /root/songhaicrm-deploy-tmp origin/main
cd /root/songhaicrm-deploy-tmp
git merge --no-edit origin/feat/gerir-tenant-editar-deletar-resetar-acesso   # fast-forward (0104670d..c37ff954)
git merge --no-edit origin/worktree-retencao-fila-e-auditoria               # 2 conflitos (ver abaixo)
git merge --no-edit origin/feat/inbox-wallpaper-whatsapp                    # limpo

# imagens (só app e worker têm diff relevante — o fix mexe em lib/ai/gateway-binding.ts,
# lib/ai/runtime/agent.ts, lib/instalacao/prova-de-credito.ts, que o worker embute via
# lib/agent-engine/agent/inbound-turn.ts; scheduler não tem diff nesta mudança)
APP_IMAGE=deskcomm-app:local APP_VERSION=57c27ff6 docker compose -f docker-compose.prod.yml -f docker-compose.build.yml --env-file /root/songhaicrm/.env build app
APP_IMAGE=deskcomm-worker:local APP_VERSION=57c27ff6 docker compose -f docker-compose.prod.yml -f docker-compose.build.yml --env-file /root/songhaicrm/.env build worker
# (mesma pegadinha do scheduler na seção 7 — o compose ignora APP_IMAGE pro worker
#  também, saiu como ghcr.io/mutambe/deskcomm-worker:latest; re-taggeado:)
docker tag ghcr.io/mutambe/deskcomm-worker:latest deskcomm-worker:local

docker service update --image deskcomm-app:local --with-registry-auth --force songhaicrm_app
docker service update --image deskcomm-worker:local --with-registry-auth --force songhaicrm_worker

# migration 0178-0180 — mesmo mecanismo das seções 5/7 (baseline.sql inteiro, idempotente)
set -a; source /root/songhaicrm/.env; set +a
docker run --rm -i -v "$(pwd)/supabase/baseline.sql:/b.sql:ro" postgres:17-alpine psql "$SUPABASE_DB_URL" -f /b.sql

git worktree remove /root/songhaicrm-deploy-tmp --force
```

**Os 2 conflitos do merge da retenção**, ambos em `supabase/baseline.sql` e
`supabase/migrations/MANIFEST.md`: a branch da retenção insere o apêndice
`0177` NO MEIO do arquivo (reposicionado "acima da varredura de anon" — um
commit próprio dela cuida disso), enquanto o catálogo (0178-0180) é apêndice
no FIM — sem overlap de conteúdo, mas o merge de 3 vias ainda acusa conflito
de contexto na borda. Resolvido mantendo os dois lados (nenhum conteúdo
descartado — conferido com `grep` antes e depois).

**Verificado:** `songhaicrm_app`/`songhaicrm_worker` `converged`; `curl` no
domínio devolve `307`; `select provider, count(*), bool_or(is_default_for_
provider) from ai_models where provider in (...)` confirma as 6 linhas
(groq=4, nvidia=3, deepseek=2, qwen=3, zhipu=1, moonshot=2), todas com
exatamente um default.

**O que NÃO foi provado antes deste deploy:** `pnpm test:db` não correu contra
as migrations `0178`/`0179`/`0180` nem, ainda, contra a `0177` (mesma dívida
já registrada na seção 7) — o ambiente do agente que implementou o catálogo
não tinha Docker disponível. Risco aceite conscientemente: as três migrations
só fazem `insert ... on conflict do update` em `ai_models`, tabela sem RLS
tenant-aware (é catálogo global), então o risco de regressão de isolamento é
baixo — mas a prova de idempotência install+update do `baseline.sql` continua
em falta pras quatro (0177-0180).

**Tarefa pendente — acumula com a seção 7, agora 3 branches + este commit:**

- [ ] Resolver o billing do GitHub.
- [ ] Mergear PR #14 (`c37ff954`) e PR #15 na `main`; abrir PR da retenção a
      partir de `worktree-retencao-fila-e-auditoria` (ou mergear direto).
- [ ] Rodar `pnpm test:db` explicitamente cobrindo as migrations `0177` a
      `0180` — nenhuma delas foi provada install+update ainda.
- [ ] Confirmar os 5 checks obrigatórios verdes nos merges.
- [ ] Na VPS: `bash self-host-kit/deploy-swarm-latest.sh` pra trocar
      `deskcomm-app:local`/`-worker:local`/`-scheduler:local` pelas imagens
      oficiais do GHCR, fechando a dívida acumulada (seções 5, 7 e 8).

