# Licenciamento self-host via PaySuite — design

> Data: 2026-09-04. Branch: `feat/paysuite-licensing`.

## Contexto e decisão de fundo

Este spec assume uma mudança de doutrina que **precede e condiciona** o desenho técnico: este
fork (`mutambe/DeskcommCRM`) deixa de operar sob o modelo "monetização = self-host, não
assinatura" registado no `CLAUDE.md` herdado do upstream. A partir desta feature, o fork:

- **Fecha o repositório de código-fonte** (fica privado). Clientes recebem apenas a imagem
  Docker publicada — não o código-fonte para buildar. Isto já era o modo de distribuição
  descrito em `docs/doctrine/packaging.md` (imagem pré-buildada, `install.sh` só faz pull); a
  mudança é que agora é a **única** via, não uma conveniência.
- **Cobra assinatura recorrente pela instalação em si**, via PaySuite (moçambicano, cobre
  M-Pesa/e-Mola/Mkesh/cartão), a quem opera a VPS — não aos clientes finais de cada tenant.

Esta decisão é do dono do fork e legítima dentro dos termos em que o upstream foi
disponibilizado (fork livre para uso conforme entendimento de quem forka). **`VISION.md` e o
`CLAUDE.md` deste fork precisam de actualização separada** para deixar de afirmar "open source"
e "não assinatura" — fora do escopo de implementação desta spec, mas é um bloqueador de
honestidade documental que deve acontecer antes ou junto do merge desta feature.

## Objectivo

Um cliente que já paga o produto e todos os outros continuam a funcionar mesmo se o serviço
central cair temporariamente; um cliente que não paga é degradado (não expulso) depois do prazo;
e nenhuma instalação de cliente consegue fabricar "activo" editando a própria base de dados,
porque a prova de licença válida é um token assinado por uma chave que o cliente não possui.

## Arquitectura

Duas superfícies, no mesmo repositório Git (mono-repo por conveniência de manutenção solo), mas
logicamente e operacionalmente separadas:

1. **Instância central** — corre só para a Songhai, sob `app/api/v1/licensing/*` e uma tela
   admin `app/(admin)/licensing`. Guarda o "livro de clientes": quem tem instalação, qual o
   estado da assinatura, histórico de pagamentos PaySuite. Detém o **par de chaves de assinatura**
   (privada) usado para emitir os tokens de licença.
2. **Instância de cliente** — o SonghaiCRM normal que cada operador de VPS corre. Ganha um
   módulo `lib/licensing/` que: (a) periodicamente pede um token novo à instância central, (b)
   verifica localmente a assinatura desse token com a **chave pública** (embutida na imagem
   Docker, não editável via acesso à base de dados do cliente), (c) aplica o gate de mutação
   conforme o `status` do token.

A chave pública fica embutida como constante em `lib/licensing/chave-publica.ts` (parte da
imagem, não do `.env`) — trocar de chave exige nova imagem publicada, o que é deliberado: só a
Songhai controla o par.

## Modelo de dados (instância central)

```sql
create table licensing_installs (
  id uuid primary key default gen_random_uuid(),
  install_token text not null unique,       -- referenciado pela instalação cliente
  customer_name text not null,
  contact_email text not null,
  notes text,
  created_at timestamptz not null default now()
);

create table licensing_licenses (
  id uuid primary key default gen_random_uuid(),
  install_id uuid not null references licensing_installs(id) on delete cascade,
  license_key text not null unique,          -- cola em LICENSE_KEY no .env do cliente
  status text not null check (status in ('trial','active','past_due','expired','revoked')),
  plan_amount_cents integer not null,
  plan_interval_days integer not null default 30,
  trial_ends_at timestamptz,
  current_period_end timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table licensing_payments (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references licensing_licenses(id) on delete cascade,
  paysuite_payment_id text not null unique,   -- idempotência de webhook
  amount_cents integer not null,
  status text not null check (status in ('pending','success','failed')),
  checkout_url text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
```

Sem RLS multi-tenant — não é dado de tenant do produto CRM, é o livro de clientes da própria
Songhai. Acesso restrito a `is_platform_admin` da instância central via auth normal do Supabase
(mesmo padrão já usado no resto do produto), não uma role nova.

Estas tabelas só existem na base de dados da **instância central**. A instância de cliente não
ganha nenhuma tabela nova de licenciamento — só cacheia o token assinado (ver secção seguinte).

## Emissão (manual, trial e pago)

Sem self-service nesta primeira versão. Fluxo:

1. Venda/acordo acontece fora do sistema (WhatsApp, email).
2. Alguém da Songhai, na tela admin da instância central, cria `licensing_installs` +
   `licensing_licenses` com `status='trial'`, `trial_ends_at = now() + interval '7 days'`,
   `current_period_end = trial_ends_at`, e já preenche `plan_amount_cents`/`plan_interval_days`
   (preço acordado — cobrança real só acontece na renovação).
3. O `license_key` gerado (ex. `crypto.randomUUID()` ou token opaco maior) é entregue ao cliente,
   que cola em `LICENSE_KEY=` no `.env` da instalação.

## Verificação (instância de cliente)

- `POST /api/v1/licensing/verify` (instância central): recebe `{ license_key }`, devolve um JWT
  curto assinado (chave privada central) com `{ status, current_period_end, iat, exp }`. `exp` do
  token = poucos dias (ex. 3) — força refresh regular sem depender só do cron.
- Cron diário na instância de cliente (mesmo padrão do `recover-stuck-messages`) chama este
  endpoint e persiste o token cru (não os campos soltos) num registo local de configuração —
  não em tabela tenant-aware.
- `lib/licensing/gate.ts`: lê o token cacheado, verifica assinatura com a chave pública embutida
  e `exp` não vencido. Resultado:
  - `trial` ou `active` → passa.
  - `past_due` ou `expired` → bloqueia mutações (`403 { error: { code: 'license_required' } }`
    em toda rota POST/PATCH/DELETE, **excepto** a própria rota de renovação de licença); leitura
    continua liberada; banner persistente na UI.
- **Falha de contacto** (rede em baixo / central fora do ar): o token tem validade própria menor
  que o grace period. Se **7 dias corridos** se passarem sem conseguir obter um token válido
  (nem do cache, nem de um novo fetch), o gate trata como `expired` — mesma degradação, motivo
  "sem contacto" em vez de "não pago", registado no log para diferenciar suporte.

## Renovação

1. Tela **Configurações › Assinatura** (instância cliente) mostra `current_period_end` e botão
   "Renovar agora".
2. Botão chama `POST /api/v1/licensing/renew` (central), autenticado por `license_key` no header.
3. Central cria `POST /api/v1/payments` no PaySuite: `amount = plan_amount_cents / 100`,
   `reference = license_id`, `method` omitido (cliente escolhe no checkout PaySuite),
   `webhook_url` apontando para `/api/v1/licensing/webhooks/paysuite` da própria central.
4. Central grava `licensing_payments` com `status='pending'`, devolve `checkout_url` para o
   cliente abrir (nova aba).
5. Cliente paga (M-Pesa/e-Mola/Mkesh/cartão) no checkout do PaySuite.
6. Webhook `POST /api/v1/licensing/webhooks/paysuite`: valida `X-Signature` (HMAC-SHA256,
   `crypto.timingSafeEqual`, mesmo padrão já usado nos webhooks WAHA). Idempotência por
   `paysuite_payment_id` (`unique` + captura `23505`). Em `payment.success`: actualiza
   `licensing_payments.status`, estende `licensing_licenses.current_period_end += interval
   'N days'` (N = `plan_interval_days`), `status='active'`. Em `payment.failed`: marca
   `licensing_payments.status='failed'`, não toca no período.
7. Próxima chamada de `verify` da instância cliente (cron diário, ou o cliente pode forçar um
   refresh manual na mesma tela) reflecte o novo `current_period_end`.

## Segurança

- Par de chaves de assinatura (ex. Ed25519) gerado uma vez, privada só na instância central
  (env var, nunca commitada), pública embutida na imagem Docker publicada.
- `license_key` funciona como credencial — tratado como segredo (não logado, transmitido só por
  HTTPS, comparação de leitura não é sensível a timing porque é lookup indexado, não comparação
  directa).
- PaySuite: `PAYSUITE_API_KEY` e `PAYSUITE_WEBHOOK_SECRET` vivem só na instância central — a
  instância de cliente nunca fala directamente com o PaySuite.
- Rate limit no endpoint `verify` (Upstash, já usado no resto do produto) — evita abuso para
  enumerar `license_key`.

## Testes / invariantes

- Unit: `lib/licensing/gate.ts` bloqueia mutação com token `expired`/`past_due`, deixa passar
  `trial`/`active`, deixa passar leitura sempre.
- Unit: verificação de assinatura do token rejeita payload adulterado (troca de `status` sem
  re-assinar).
- Unit: webhook PaySuite rejeita `X-Signature` inválida; idempotência — reenviar o mesmo
  `paysuite_payment_id` não duplica extensão do período.
- Integração: fluxo completo `renew` → webhook `payment.success` → `verify` seguinte reflecte
  `current_period_end` estendido.
- E2E (Playwright, doutrina de QA Visual): banner de degradação aparece quando o gate bloqueia,
  desaparece após renovação simulada; botão "Renovar agora" abre `checkout_url` real.

## Fora de escopo desta spec

- Self-service de signup/pagamento inicial (emissão continua manual).
- Cobrança automática/cartão guardado (PaySuite não oferece na doc consultada — reconfirmar
  antes de implementar qualquer automatismo de cobrança sem acção do cliente).
- Actualização de `VISION.md`/`CLAUDE.md` deste fork para reflectir o fecho do repositório —
  tratar como tarefa separada, idealmente antes do merge desta feature.
