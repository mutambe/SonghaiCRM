# Runbook — SMTP e templates de e-mail do GoTrue em produção

Configuração aplicada em produção em 2026-09-11, diretamente no servidor de
autenticação (`supabase_auth`, Docker Swarm, servidor separado da VPS do app —
ver `docs/deploy-selfhost/README.md` §3.5 para o raciocínio geral e as
armadilhas medidas). **Nada disto está em `docker-compose.*`/`.env` versionado
— é estado vivo do Swarm, aplicado via `docker service update`.** Se o
servidor de autenticação for reconstruído do zero, este runbook é o que
resta para refazer.

## Topologia (2026-09-11)

- App (`songhaicrm`, Swarm): VPS `13.140.169.98`.
- Auth/Supabase self-hosted (`supabase`, Swarm, serviço `supabase_auth` =
  GoTrue v2.189.0): VPS separada, `manager.songhai.cc` / `173.249.31.153`,
  nó único usado para bind mounts: hostname `vmi2968866`.
- `NEXT_PUBLIC_SUPABASE_URL=https://supabase.songhai.cc` no `.env` do app.

## O que está configurado no serviço `supabase_auth`

```bash
docker service update \
  --env-add GOTRUE_SMTP_HOST=smtp.resend.com \
  --env-add GOTRUE_SMTP_PORT=587 \
  --env-add GOTRUE_SMTP_USER=resend \
  --env-add GOTRUE_SMTP_PASS=<API key do Resend, conta com domínio songhai.cc verificado> \
  --env-add GOTRUE_SMTP_ADMIN_EMAIL=contato@songhai.cc \
  --env-add GOTRUE_SMTP_SENDER_NAME=SonghaiCRM \
  --env-add GOTRUE_SITE_URL=https://crm.songhai.ltd \
  --env-add GOTRUE_URI_ALLOW_LIST=https://crm.songhai.ltd/auth/confirm \
  --env-add GOTRUE_MAILER_TEMPLATES_CONFIRMATION=http://supabase-email-templates/confirmation.html \
  --env-add GOTRUE_MAILER_TEMPLATES_RECOVERY=http://supabase-email-templates/recovery.html \
  --env-add GOTRUE_MAILER_TEMPLATES_INVITE=http://supabase-email-templates/invite.html \
  --mount-add type=bind,source=/opt/supabase-emails,destination=/templates,readonly \
  --force \
  supabase_auth
```

Porta **587** (STARTTLS), não 465 — não testado a fundo se 465 falha
estruturalmente ou só nesta rede, mas 587 foi o que funcionou. `GOTRUE_MAILER_TEMPLATES_*`
aponta para o **serviço HTTP interno** (`supabase-email-templates`), não para
o caminho `/templates/*.html` do bind mount — ver a explicação em
`docs/deploy-selfhost/README.md` §3.5 (o GoTrue busca o template por HTTP,
não lê do disco; um caminho de arquivo falha em silêncio, sem log nem em
`GOTRUE_LOG_LEVEL=debug`). O bind mount em `/templates` continua existindo
só porque o serviço `supabase-email-templates` (abaixo) o serve.

## O serviço `supabase-email-templates`

Nginx mínimo, sem porta publicada, só acessível pela rede interna do Swarm:

```bash
docker service create \
  --name supabase-email-templates \
  --network supabase_supabase_internal \
  --mount type=bind,source=/opt/supabase-emails,destination=/usr/share/nginx/html,readonly \
  --restart-condition any \
  --constraint-add node.hostname==vmi2968866 \
  nginx:alpine
```

A rede (`supabase_supabase_internal`) tem de ser a mesma que
`supabase_auth` usa — confira com
`docker service inspect supabase_auth --format '{{range .Spec.TaskTemplate.Networks}}{{.Target}}{{end}}'`
seguido de `docker network inspect <id> --format '{{.Name}}'`, pode ter
nome diferente noutra instalação.

O `--constraint-add` é necessário porque este Swarm tem mais de um nó e um
bind mount só existe no nó onde o arquivo está — sem a constraint, o Swarm
já tentou agendar a tarefa no outro nó (`vmi2974672`) e falhou repetidamente
(`invalid mount config: bind source path does not exist`) antes de convergir
no nó certo por sorte de ordem de tentativa.

## Os arquivos em `/opt/supabase-emails/`

Renderizados a partir do repositório (na VPS do APP, onde o `.env` tem
`APP_NAME`/`APP_ACCENT_HEX`) e copiados para cá:

```bash
# na VPS do app:
bash self-host-kit/marca-emails.sh --render-em /tmp/emails-renderizados
# copiar confirmation.html, recovery.html, invite.html para
# /opt/supabase-emails/ na VPS de auth
```

Reaplique isto sempre que a marca (`APP_NAME`/`APP_ACCENT_HEX`) mudar — o
Nginx serve o que estiver no disco, não há cache a limpar além do próprio
`GOTRUE_MAILER_TEMPLATE_MAX_AGE` do GoTrue (padrão curto, não é o gargalo
aqui).

## O domínio do Resend

Conta Resend com o domínio **`songhai.cc`** verificado (SPF/DKIM via
Cloudflare, verificado em 2026-09-10/11). Remetente em uso:
`contato@songhai.cc`.

⚠️ Antes da verificação do domínio, a conta estava em modo sandbox — só
enviava para o e-mail que criou a conta Resend, e mesmo esse envio (com
`onboarding@resend.dev`) chegava a ser aceito pelo Gmail via SMTP
("Delivered" no painel do Resend) e descartado depois, sem cair em spam.
**Isto não é bug de configuração — é o comportamento esperado do modo
sandbox**, documentado agora em `docs/deploy-selfhost/README.md` §3.5 para
quem instalar do zero.

## Verificação (reproduzir se precisar depurar de novo)

```bash
# 1) o serviço de templates está a servir?
docker exec $(docker ps -q -f name=supabase-email-templates) \
  wget -qO- http://localhost/invite.html | head -5

# 2) o GoTrue alcança o serviço pela rede interna?
docker exec $(docker ps -q -f name=supabase_auth) \
  wget -qO- http://supabase-email-templates/invite.html | head -5

# 3) convite real via Admin API (não passa pela UI, direto no GoTrue)
curl -X POST 'https://supabase.songhai.cc/auth/v1/invite' \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"email":"SEU_EMAIL_REAL@dominio.com","data":{}}'
# 200 com confirmation_sent_at preenchido = GoTrue tentou enviar.
# Não prova entrega — confira a caixa de entrada de verdade.

# 4) se não chegar e o passo 3 devolver 200 (não 500), o erro real só
# aparece com log verboso, e só se for de fato um usuário NOVO (o GoTrue
# não reenvia silenciosamente para quem já foi convidado e ainda não
# confirmou, dentro de alguma janela não documentada aqui — teste sempre
# com um e-mail nunca usado antes):
docker service update --env-add GOTRUE_LOG_LEVEL=debug --force supabase_auth
# repita o passo 3 com email NOVO, depois:
docker service logs supabase_auth --since 2m | grep -i 'gomail\|error'
# reverta depois:
docker service update --env-rm GOTRUE_LOG_LEVEL --force supabase_auth
```

## O que falta (dívida documentada)

- Nada disto está em `docker-compose.*` versionado — é 100% estado vivo do
  Swarm. Reconstruir o servidor de auth do zero exige reaplicar este runbook
  inteiro à mão.
- `self-host-kit/marca-emails.sh` ainda assume que quem tem Management API
  (Supabase Cloud) resolve tudo por lá — o caminho self-hosted (`--render-em`
  + servidor HTTP + env vars do GoTrue) continua manual, sem script
  dedicado. Um `self-host-kit/configurar-emails-selfhosted.sh` que
  automatizasse os passos deste runbook (subir o Nginx, gerar os `docker
  service update`) seria a próxima melhoria natural, mas não foi escrito
  aqui — fora do escopo do que foi pedido nesta sessão.
