# SonghaiCRM × upstream — as diferenças que causam erro

> **Leia antes de mexer em código, testes ou no CI, e SEMPRE depois de um
> `git merge upstream/main`.** O upstream (DeskcommCRM) é brasileiro e escreve
> o Brasil em todo o lado: texto, fuso, moeda, telefone, documento, testes. O
> SonghaiCRM é Moçambique. Cada linha desta página é uma diferença que **já
> causou um erro real** (em CI, em teste ou no produto) entre 2026-10-01 e
> 2026-10-02 — está aqui para não se repetir.
>
> Doutrina geral: secção "SONGHAICRM" do [`CLAUDE.md`](../CLAUDE.md).
> Registo do que foi portado: [`upstream-sync.md`](upstream-sync.md).

## Resumo — o que o upstream assume e o que vale aqui

| Tema | Upstream (Brasil) | SonghaiCRM (Moçambique) | Fonte única no código | Vigiado por |
|---|---|---|---|---|
| País | `BR` (vazio = Brasil) | **`MZ`** (vazio = Moçambique); o Brasil NÃO está no registro | `PAIS_PADRAO` em `lib/legal/perfil-do-pais.ts` | `tests/unit/pais-padrao-mocambique.test.ts` |
| Idioma visível | pt-BR, es, en | **só pt-MZ** | `lib/i18n/registro.ts` | `tests/unit/i18n-portugues-de-mocambique.test.ts` |
| Texto da tela | português do Brasil | camada pt-MZ sobre `t()`, `fail()` e e-mail | `lib/i18n/pt-mz.ts`, `lib/i18n/frases-pt-mz.ts` | idem + `frases-pt-mz-casam-com-a-fonte.test.ts` |
| Espanhol | seletor na tela | **sem seletor**; fica no dicionário como dado | `lib/i18n/registro.ts` | `e2e.yml` (`FORA_DO_CI`) |
| Fuso | `America/Sao_Paulo` (UTC−3) | **`Africa/Maputo` (UTC+2, sem horário de verão)** | `FUSO_PADRAO` em `lib/tempo/fusos.ts` | `tests/unit/fuso-de-mocambique.test.ts` |
| Moeda | BRL, `R$ 249,90` | **MZN, `249,90 MTn`**, rótulo "Metical (MTn)" | `MOEDA_PADRAO`/`MOEDAS_SERVIDAS` em `lib/money.ts` | `tests/unit/moeda-metical-mtn.test.ts` |
| Formato de data | `29 de ago. de 2026` | **`29/08/2026`** (Intl em pt-MZ) | locale `pt-MZ` | specs de agenda |
| Telefone | +55, 11 dígitos | **+258**, telemóvel `8[2-7]` + 7 dígitos | `lib/channels/telefone-local.ts` | testes de telefone |
| Documento | CPF (11 dígitos, dígito verificador) | **NUIT (9 dígitos, sem verificador público)** | `isValidNuit` em `lib/legal/perfil-do-pais.ts` | `tests/unit/nuit-no-roteiro-nunca-cortado.test.ts` |
| Lei de dados | LGPD | **Lei n.º 3/2017** | perfil `MZ` em `lib/legal/perfil-do-pais.ts` | testes do perfil |
| Feriados | Brasil | **Moçambique** | `lib/lgpd/holidays-mz.ts` | testes de dias úteis |
| Janela de envio | 7h–22h | **6h–23h**, domingo aberto | `PACING_DEFAULTS` | `tests/unit/janela-de-cortesia-6h-23h.test.ts` |
| Marca | DeskcommCRM | **SonghaiCRM** pela semente do instalador | `hostgator-setup-kit/_common.sh` | `tests/shell/single-server-operacao.test.sh` |
| Módulos | Nuvemshop, Honorários, CRM B2B (BrasilAPI) | **desligados** (nunca apagados) | mecanismos do upstream | — |

## 0. País — Moçambique, e o Brasil fora do registro

**A regra.** O país padrão é `PAIS_PADRAO` = `MZ`; a coluna
`organizations.country` vazia vale Moçambique. O perfil brasileiro não está no
registro, e a gravação recusa país sem perfil ("País sem perfil revisado").

**Erro que isto já causou — no PRODUTO, o mais grave até agora.** A tela
Configurações › Organização abria com `country: row.country ?? "BR"`. Como a
organização nasce com o país vazio, TODA gravação dessa tela (nome, fuso,
moeda, retenção) voltava "País sem perfil revisado: BR" — nenhuma organização
conseguia salvar as próprias configurações. Achado pelo e2e de moeda, que
"falhava" sem a confirmação "Organização atualizada".

**Como fazer certo.** Nunca escreva `"BR"` como valor de reserva: use
`PAIS_PADRAO`. O teste reprova qualquer `"BR"` fora de comentário no código
que embarca.

## 1. Idioma — só português de Moçambique

**A regra.** O único idioma visível é `pt-MZ`. O texto das telas continua
escrito no código em pt-BR (é o do upstream) e passa por `t()`, onde a camada
`lib/i18n/pt-mz.ts` aplica a norma moçambicana: vocabulário (contacto, ecrã,
equipa, palavra-passe, e-mail), gerúndio → «a» + infinitivo, troca de género
com concordância, artigo antes do possessivo, ênclise. Frases inteiras que o
**cliente** recebe sem passar pela IA vão escritas à mão em
`lib/i18n/frases-pt-mz.ts`.

**Erros que isto já causou.**
- Testes do upstream que comparam texto em pt-BR falham com o texto pt-MZ:
  `"Novo contato pelo WhatsApp"` × `"Novo contacto pelo WhatsApp"`,
  `/mudou/` × `"foi alterado"`, `"Email ou senha incorretos"` × `"e-mail"`/
  `"palavra-passe"`. **O produto está certo; a expectativa do teste é que é
  brasileira.**
- Etiquetas do upstream que nomeiam coisas do Brasil aparecem ao utilizador
  moçambicano se ninguém as traduzir: "CPF (confere o dígito)" no construtor de
  roteiros (corrigida pelo registo de frases). A dica "ex.: Africa/Maputo" da
  proteção de envio foi corrigida no próprio componente.
- **Chave do registo de frases que não existe no código reprova o CI**
  (`frases-pt-mz-casam-com-a-fonte`). Antes de acrescentar uma frase, confira
  com `grep` que o texto EXATO está num `t("…")` de `app/`, `components/`
  ou `lib/` — não basta estar no dicionário.

**Como fazer certo.**
- Texto novo de tela: escreva-o em `t("…")`, como o upstream. Se a camada não
  o deixar em pt-MZ correcto, acrescente a frase inteira em
  `lib/i18n/frases-pt-mz.ts` (a chave tem de existir no código — há teste).
- Teste **unitário ou de base de dados** que lê texto gerado pelo servidor:
  espere o texto em **pt-MZ** (é o que o produto grava e mostra).
- Teste **de ecrã (e2e)**: o CI liga `NEXT_PUBLIC_PT_MZ_TEXTO_ORIGINAL=1` SÓ no
  build do e2e, e a camada devolve o texto original — as specs do upstream
  medem COMPORTAMENTO com os seletores que já têm. O texto moçambicano é
  provado pelos testes unitários. Esse interruptor **nunca** pode chegar à
  imagem, ao kit ou a um `.env` (vigiado por
  `tests/unit/pt-mz-interruptor-so-no-e2e.test.ts`).
- **Formatos de número e data não passam pela camada**: vêm do `Intl` em
  `pt-MZ`. Por isso, mesmo no e2e com texto original, a data é `29/08/2026` e
  o dinheiro é `249,90 MTn`.

## 2. Espanhol — desligado, não apagado

**A regra.** O espanhol do dicionário fica no código (apagar gera conflito em
todo merge, e o guarda do upstream `i18n-espanhol-cobre-a-tela` continua a
exigir a entrada `es` de cada texto novo). Mas **não há seletor de espanhol na
tela**: `pt-MZ` é o único idioma em `lib/i18n/registro.ts`.

**Erros que isto já causou.** Specs do e2e que clicam em `idioma-es` esperam
até ao fim do tempo e falham. E há um SEGUNDO caminho, que a busca por
`idioma-es` não acha: a spec grava `user_metadata: { locale: "es" }` na base de
dados, recarrega e espera texto em espanhol ("Abrir conversación", "Historial
cerrado") — aqui a tela continua em português. Procure os dois:
`grep -rlnE 'locale: "es"|idioma-es' tests/e2e/*.spec.ts`.

**Como fazer certo.**
- Texto novo de tela continua a precisar da entrada `es` no dicionário (é
  regra do upstream e o CI cobra).
- Spec que é **inteira** sobre espanhol → `FORA_DO_CI` em
  `.github/workflows/e2e.yml`, com o motivo escrito (feito para
  `i18n-espanhol-na-tela.spec.ts`).
- Spec que só **em parte** usa espanhol → tira-se o trecho e deixa-se o
  comentário `SonghaiCRM: a distribuição só oferece pt-MZ`
  (feito em `extensoes-recuperacao`, `central-avisos-resolver-em-lote`,
  `agenda-presenca-recuperacao`, `central-avisos-destino`,
  `encerramento-atendimento`). Se o trecho em espanhol também exercitava um
  comportamento (reabrir, fechar), mantenha o comportamento com os rótulos em
  português — só a troca de idioma sai.

## 3. Fuso horário — Africa/Maputo

Regra completa e não negociável na secção **"Fuso horário — Moçambique"** do
[`CLAUDE.md`](../CLAUDE.md). O essencial: UTC+2 sem horário de verão; nunca
`America/Sao_Paulo`/`-03:00` (5 horas de erro); fuso da organização ou
`FUSO_PADRAO`; instante sempre com `Z` ou `+02:00`; nada de `getHours()`/
`setHours()` (relógio do processo = UTC no servidor e no CI); exemplos para a
IA em `+02:00`.

**Erros que isto já causou.** Dezenas de casos de e2e de agenda e relatório;
a instalação fresca esperava São Paulo; a ferramenta MCP de agendamento
ensinava a IA a escrever `-03:00`.

**Dívida conhecida (herdada).** `lib/automation/throttle.ts` adia o limite
diário para as 7h do relógio do processo (UTC) — em Maputo, 9h. Não envia
fora de horas, só mais tarde.

## 4. Moeda — Metical (MTn)

**A regra.** Organização nasce em `MZN` (`songhai.sql`). Moedas servidas:
`MZN`, `USD`, `ZAR`, `EUR` (`MOEDAS_SERVIDAS`). Formato `249,90 MTn` e
`249,90 US$`; rótulo `Metical (MTn)` e `Dólar americano (US$)`. A cobrança
PaySuite recusa negócio fora de metical.

**Erros que isto já causou.** O e2e `moeda-da-organizacao` esperava a
organização em BRL e trocava para peso mexicano (MXN), que nem está servido.

**Como fazer certo.** Teste de moeda usa as moedas servidas e o rótulo pt-MZ;
nunca BRL, `R$` ou MXN.

## 5. Telefone — +258

**A regra.** Telemóvel moçambicano: `8[2-7]` + 7 dígitos (com ou sem `258`);
fixo `2[1-9]` + 6 dígitos (`lib/channels/telefone-local.ts`).

**Erros que isto já causou.** O e2e `automacao-diz-a-verdade` criava o lead com
`11933332222` (São Paulo): aqui esse número **não vira contacto**, e a automação
falhava por "sem contacto" em vez do motivo que o teste queria provar.

**Como fazer certo.** Dados de teste com telefone usam `84…`/`+25884…`.

## 6. Documento — NUIT, não CPF

**A regra.** O documento do titular é o NUIT: 9 dígitos, sem dígito
verificador público (confere-se a FORMA, `isValidNuit`). O tipo de campo do
roteiro chama-se `cpf` por vocabulário do upstream — **não renomeie** (merge),
mas na tela ele aparece como "NUIT (9 dígitos)".

**Erro que isto já causou — no PRODUTO.** O cliente escreveu
`529.982.247-25` (11 dígitos) e o roteiro gravou o NUIT `529982247`, cortado em
silêncio: a borda da captura não olhava o separador. Corrigido
(`lib/followup/captura-do-fluxo.ts`, `NUIT_NO_TEXTO`): o NUIT só conta como número
inteiro; na dúvida, o roteiro pergunta de novo.

**Como fazer certo.** Teste com documento usa um NUIT de 9 dígitos
(ex.: `400 123 456`). Nunca extraia 9 dígitos de dentro de um número maior.

## 7. Decisões de operação que diferem do upstream

| Decisão | Valor | Onde |
|---|---|---|
| Janela de cortesia | 6h–23h, domingo aberto | `PACING_DEFAULTS` |
| Warm-up do número novo (dias 0–3) | 20 mensagens/dia (igual ao upstream; decidido manter) | `PACING_DEFAULTS.warmupDailyCaps` |
| Canal novo | nasce em "IA em modo de teste" (igual ao upstream; decidido manter) | `lib/ai/elegibilidade/pre-go-live.ts` |
| Licença por organização | pacotes em MZN; sem assinatura = sem bloqueio | migration 9004 |
| Funcionalidades por pacote | `plans.limits.features` (ausente = todas); recusa em `requireRole`, `orgAtivaDaApi`, `resolveAuthDual`, menu, ferramentas do agente e `PortaDoPlano`; falha ABERTA | migration 9008, `lib/plans/funcionalidades.ts` |
| Agente-modelo por cliente | `POST /api/v1/admin/tenants/[id]/package`; origem em `ai_agents.source_*` | migration 9009, `lib/ai/agents/aplicar-modelo.ts` |
| Faturação dos pacotes | automática, PaySuite, de hora a hora; extras e preço acordado por cliente | migration 9010, `lib/billing/`, `docs/songhai-faturacao.md` |
| Aviso de caso por e-mail | canal adicional ao do WhatsApp, em lista (até 10); o aviso no WhatsApp continua com um só número e não se mexeu no corte da ingestão | migration 9012, `lib/escalacao/aviso-por-email.ts`; registado em `lib/event-log/register-handlers.ts` e classificado em `tests/unit/dispatcher-org-parada.test.ts` |

### 7.1 Faturação × ADR-0004 do upstream — o risco do próximo merge

O upstream aceitou a ADR-0004 (cobrança do revendedor: planos, assinaturas, régua, Stripe e
Asaas) e desenhou-a em 7 PRs, ainda por entregar quando isto foi escrito. A distribuição
construiu a sua versão enxuta, com PaySuite, e **os nomes divergem de propósito**:

| Conceito | Upstream (desenho) | SonghaiCRM |
|---|---|---|
| Planos | `cobranca_planos` | `plans` |
| Assinaturas | `cobranca_assinaturas` | `organization_subscriptions` |
| Facturas | (sem tabela; o provedor guarda) | `billing_invoices`, `billing_invoice_lines` |
| Suspensão por dívida | `fn_suspender_organizacao(…, 'cobranca', …)` | **a mesma função** — é o ponto de encontro |
| Chave de ligar | `MODULO_COBRANCA` em `platform_config` | `BILLING_ORGANIZATION_ID` em `platform_config` |

Quando o upstream entregar a cobrança, **não há colisão de nomes**, mas há dois sistemas a
decidir a mesma coisa (quem está em dívida). Antes de qualquer `git merge` que traga
`cobranca_*`: decidir qual vence, e migrar as assinaturas (não os nomes). A suspensão
(`suspended_kind = 'cobranca'`) e a reactivação são partilhadas e não precisam de migração.

## 8. CI, versões e publicação

- **Typecheck do CI com heap de 8 GB** (`NODE_OPTIONS` só no passo Typecheck do
  `ci.yml`, desde 2026-10-03). Sem cache incremental o `tsc` usa ~4,2 GB, o
  heap padrão do Node; o código da distribuição passou do limite e o job morreu
  com «heap out of memory». Num merge que conflite aqui, mantenha o `env:`.
- **Migrations da distribuição usam a faixa `9001+`** (desde 2026-10-03). O
  upstream numera em sequência e já tomou 0501–0504, os números que as nossas
  tinham; numa faixa própria, nenhum merge futuro colide. Migration nova do
  SonghaiCRM = o próximo `9NNN`, com timestamp, linha no MANIFEST e bloco no
  `songhai.sql`.
- **Nunca empurre as tags `v*` do upstream para o repositório do SonghaiCRM.**
  Push de `v*` dispara a publicação de imagens: sairia o código brasileiro do
  upstream com o nome da Songhai, e o canal `stable` poderia mover.
- A conferência de isolamento do kit (`scripts/conferir-isolamento-do-kit.sh`)
  busca do upstream, só leitura, a tag que o fork não tem; e o job
  `invariants` usa `CONFERENCIA_KIT_RELEASE: v1.69.0` **até o SonghaiCRM
  publicar a primeira release** — depois, tire essa linha do `ci.yml`.
- O workflow `release` do upstream falha aqui por falta da GitHub App
  (`RELEASE_APP_ID`/`RELEASE_APP_PRIVATE_KEY`). **Desligado no repositório
  desde 2026-10-03** (`gh workflow disable release.yml --repo mutambe/SonghaiCRM`):
  a definição do GitHub sobrevive a todo merge, e o arquivo do upstream fica
  intocado. Versão publica-se com a tag `vX.Y.Z` feita à mão, como a v2.0.0.
  Para religar (depois de criar a App): `gh workflow enable release.yml`.
- Nome de provider (waha, zernio…) só dentro de `lib/channels/`
  (`pnpm lint:channels`) — inclusive em comentário.

## 9. Infraestrutura — a VPS do dono

- A VPS usa **Docker Swarm + Portainer + Traefik**. O stack é
  `docker-compose.swarm.yml`, preso ao `docker-compose.prod.yml` por
  `tests/unit/swarm-acompanha-o-compose-de-producao.test.ts`. Deploy:
  `bash hostgator-setup-kit/deploy-swarm.sh` (banco ANTES das imagens).
- **Limites contra abuso (2026-10-03).** No Traefik do Swarm existem dois
  middlewares por IP — `deskcomm-limite` (`TRAEFIK_PEDIDOS_POR_SEGUNDO` 100, pico
  `TRAEFIK_PICO_DE_PEDIDOS` 200) e `deskcomm-ligacoes` (`TRAEFIK_LIGACOES_POR_IP`
  60) —, que contam pelo cabeçalho `CF-Connecting-IP` e nascem **desligados**:
  com as portas do Swarm em modo "ingress" o Traefik vê o mesmo IP interno para
  todos, e um limite pelo endereço da ligação viraria limite do site inteiro.
  Liga-se com `TRAEFIK_MIDDLEWARES_DO_APP=deskcomm-limite,deskcomm-ligacoes,deskcomm-compress`
  no `.env`, **só** com a Cloudflare à frente e as portas 80/443 da VPS fechadas a
  quem não é ela (senão o cabeçalho pode ser forjado). No app, `/api/v1/health`
  (público e caro, 4–5 s) tem 30/min por IP, ao lado de MCP/internal/cron
  (`lib/auth/limite-das-superficies-internas.ts`). **Nada disto trava DDoS
  volumétrico**: isso é a Cloudflare, na rede (guia entregue ao dono em 2026-10-03).
- O `docker-compose.swarm.yml` antigo do fork (lista de variáveis à mão,
  imagens `melgarafael`, evento `message` duplicado) **não** deve ser usado.
- **O `env_file` do Swarm não tira aspas** (o do `docker compose` tira). O
  .env do kit grava tudo entre aspas, e na primeira instalação 2.0.0 todas as
  variáveis chegaram ao contêiner com elas: o app não arrancava
  ("NEXT_PUBLIC_ADMIN_URL: Invalid URL"). O `deploy-swarm.sh` gera
  `.env.swarm` (permissão 600, ignorado pelo git) com os valores já
  descodificados. No Portainer, cole as variáveis **sem aspas**.
- **Trocar só as imagens sem o banco quebra o CRM.** Em 2026-10-02 a VPS ficou
  horas a correr o código novo sobre o esquema antigo (alguém fez pull de
  `:latest`). Atualize sempre por `deploy-swarm.sh`, nunca com um pull solto.

## 10. Ambiente de desenvolvimento (Windows)

- O Windows deste PC bloqueia (Smart App Control / Controlo de Aplicações) o
  binário nativo do `rolldown`, e o Vitest não arranca: "An Application Control
  policy has blocked this file". `pnpm typecheck` e os lints funcionam; os
  testes rodam no CI do GitHub.
- Heredoc do bash e `node -e` neste ambiente **comem barras invertidas**
  (`\d` vira `d`, `\n` vira quebra de linha real). Escreva scripts e testes com
  o editor, não por heredoc.

## Checklist depois de cada `git merge upstream/main`

```bash
# 1. Brasil a voltar no código que embarca e nas specs (o esperado são só as exceções nomeadas)
grep -rnE "America/Sao_Paulo|-03:00" app components hooks lib workers tests/e2e \
  --include=*.ts --include=*.tsx | grep -v '\.test\.' | grep -vE ':\s*(//|\*|/\*)'
# 2. moeda e documento brasileiros em specs (compare com a lista ANTES do merge:
#    só importa o que o merge acrescentou)
grep -rlnE "R\\$|BRL|MXN|cpf é|CPF\?" tests/e2e/*.spec.ts
# 3. specs que põem a tela em espanhol — pelo botão OU pela base de dados
#    (agenda-presenca-recuperacao e central-avisos-resolver-em-lote aparecem
#    por um ramo "es" desligado e um caso em test.skip — não são achado)
grep -rlnE 'locale: "es"|idioma-es' tests/e2e/*.spec.ts
# 4. o resto é o CI: verify, invariants e e2e verdes
```

**Telefone +55 nas specs não é achado automático.** Dezenas de specs do
upstream gravam contacto com número brasileiro DIRECTO na base de dados e
passam. O número brasileiro só quebra quando passa pela normalização de
telefone (formulário, webhook de entrada, importação de planilha): aí ele não
vira contacto. Ajuste quando o CI apontar, não por varredura.

Para cada achado: ajuste a spec ao que a distribuição é (secções acima), com
um comentário `SonghaiCRM:` a dizer porquê — é esse comentário que o próximo
merge lê quando o mesmo arquivo conflitar.
