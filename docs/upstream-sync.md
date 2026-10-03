# SonghaiCRM sobre o DeskcommCRM — sincronia com o upstream

O SonghaiCRM (Songhai, Lda — Moçambique) é o
[DeskcommCRM](https://github.com/melgarafael/DeskcommCRM) (remote `upstream`) com a
identidade moçambicana por cima.

> As diferenças que causam erro (idioma, fuso, moeda, telefone, NUIT, CI) e o
> checklist depois de cada merge: [`songhai-diferencas-do-upstream.md`](songhai-diferencas-do-upstream.md).

## A estratégia (decisão do dono do produto, 2026-10-01)

Até 2026-09-30 o fork vivia separado e portava funcionalidades do upstream à mão. Medido
nessa data: desde o ancestral comum `277f9c040`, o upstream cresceu **~407 mil linhas** de
código e o fork **~20 mil**. Portar o upstream para dentro do fork nunca acompanharia.

A base foi **invertida**: a branch `songhai/base-upstream` nasce do `upstream/main`
(`e8e291217`, v1.69.0) e reaplica por cima o que é do SonghaiCRM. Não havia instalação com
dados reais, então não houve migração de dados do schema antigo do fork.

**Sincronizar daqui em diante:**

```bash
git fetch upstream
git merge upstream/main          # resolver conflito com as regras do CLAUDE.md (bloco SONGHAICRM)
pnpm typecheck && pnpm test:unit && pnpm test:db
```

## Como a identidade entra sem brigar com o merge

| O quê | Onde | Regra |
|---|---|---|
| País (NUIT, +258, Lei 3/2017, feriados) | `lib/legal/perfil-do-pais.ts`, `lib/lgpd/holidays-mz.ts` | Perfil `MZ` padrão; o BR não está no registro |
| Moeda | `lib/money.ts` | `MOEDA_PADRAO = "MZN"`; nunca literal `"BRL"` |
| Fuso | `lib/tempo/fusos.ts` | `FUSO_PADRAO = "Africa/Maputo"`; nunca literal |
| Idioma | `lib/i18n/registro.ts`, `lib/i18n/pt-mz.ts` | `pt-MZ` único visível; camada de vocabulário sobre `t()` |
| Frases ao cliente | `lib/i18n/frases-pt-mz.ts` | Frase-fonte do upstream → frase escrita para Moçambique (agenda, modelos de follow-up). Chave órfã depois de um merge reprova em `tests/unit/frases-pt-mz-casam-com-a-fonte.test.ts` |
| Voz do agente de IA | `lib/agent-engine/playbooks/platform.md` | Camada plataforma em português de Moçambique; instalação existente recebe pela 9002 |
| Banco | `supabase/songhai.sql` | Apêndice aplicado depois do `baseline.sql`; o baseline fica intocado |
| Testes da distribuição | `tests/unit/*.test.ts` próprios | Não editar teste do upstream quando dá para acrescentar |

## Já aplicado nesta base

| Data | O quê | Migration |
|---|---|---|
| 2026-10-01 | Perfil de país MZ; NUIT no documento do titular e na captura de campos do follow-up; feriados MZ no SLA | — |
| 2026-10-01 | Moeda MZN (padrão e moedas servidas); fuso Africa/Maputo; defaults do banco | 9001 |
| 2026-10-01 | Idioma pt-MZ com camada de vocabulário; espanhol e pt-BR escondidos | — |
| 2026-10-01 | Sentry e anonimizador do RAG apagam telefone/NUIT moçambicanos (o padrão do upstream só pegava a forma brasileira) | — |
| 2026-10-01 | Trava de promessas do agente enxerga metical (antes era cega: só real e euro) | — |
| 2026-10-01 | Descrições de ferramenta do agente pedem português de Moçambique, não pt-br | — |
| 2026-10-01 | Camada plataforma do playbook, prompt padrão de agente e prompt de prospecção mandavam escrever "em português do Brasil" — agora português de Moçambique, com vocabulário e construções | 9002 |
| 2026-10-01 | Mensagens fixas ao cliente (agenda, lembrete, 13 mensagens dos modelos de follow-up) reescritas em português de Moçambique; data da reunião com ano de 4 dígitos | — |
| 2026-10-01 | Sexta-feira Santa confirmada como feriado nos prazos (decisão do dono do produto) | — |
| 2026-10-01 | "Tudo em português de Moçambique": a camada `pt-mz.ts` passou de troca de palavra a norma — gerúndio → «a» + infinitivo, nome que muda de gênero com concordância (tela → ecrã, aplicativo → aplicação, banco → base de dados), artigo no possessivo, ênclise, "aceder a", "precisar de", "noutro". Revisada contra as 8 751 frases do produto. Aplicada também no `fail()` (erros da API), no roteador de e-mail e nos moldes do GoTrue | — |
| 2026-10-01 | Kit: imagens `ghcr.io/mutambe`, clone de `github.com/mutambe/SonghaiCRM`, `DESKCOMM_VERSAO=<tag>` para testar imagem de branch | — |
| 2026-10-01 | Marca SonghaiCRM **pelo caminho do upstream** (semente do instalador, não código): `APP_NAME=SonghaiCRM` e `APP_ACCENT_HEX=#008069` como padrão no `install.sh`, `install-single-server.sh` e `.env.hostgator.example`; o desenho vetorial "Deskcomm" não aparece porque o nome não é o do upstream. `DEFAULT_APP_NAME` fica — trocá-lo é o que `marca-do-produto-nao-se-edita-no-codigo.test.ts` proíbe. Logo da Songhai em `branding/logo/` (versão de 51 KB para subir em Admin › Marca). Idioma da instalação: "Português" grava `pt-MZ` (o kit e o `bootstrap-owner.ts` gravavam `pt-BR`) | — |
| 2026-10-01 | Segurança: convite sem segredo falha FECHADO (o upstream assina com `"dev-fallback"`); teto de tentativas por IP em `/api/mcp`, `/api/internal/*` e `/api/v1/cron/*` aplicado UMA vez no `proxy.ts` (`lib/auth/limite-das-superficies-internas.ts`; sem IP não limita, para não trancar o scheduler); scan de segredo no pre-commit (`scripts/scan-secrets.mjs`) + job `secrets` no CI (gitleaks 8.21.2, `.gitleaks.toml` auditado: zero achados na base, token plantado é pego). `legal_name` nullable do fork NÃO reaplicado: o upstream já cai no `display_name` | — |
| 2026-10-01 | PaySuite (M-Pesa, e-Mola, cartão): `payment_credentials` (só servidor) + `payments` (log por organização); `POST /api/v1/integrations/paysuite`, `POST /api/v1/leads/[id]/charge`, webhook `/api/v1/webhooks/payments/paysuite/[token]`; tela em Organização › Pagamentos e botão "Cobrar" no dossiê. Diferenças do fork: recusa negócio fora de metical, URL do webhook pela `basePublicaDaInstalacao` do upstream, guarda de suporte + auditoria em cada mutação, e a reentrega do webhook não duplica "Pagamento confirmado" | 9003 |
| 2026-10-01 | Moeda "Metical (MTn)": `249,90 MTn` e `249,90 US$` (pt-MZ), nome da moeda no seletor e nos títulos (`rotuloDaMoeda`); gráficos de gasto de IA diziam "(R$)" sobre valores em dólar — agora "(US$)" | — |
| 2026-10-01 | Licença por organização: `plans` (Agente Simples/Médio/Avançado/Enterprise, preços em MZN) + `organization_subscriptions` (uma vigente por organização, índice parcial) + `fn_trocar_plano_da_organizacao` (atómica, só `service_role`). Teto de utilizadores no convite E no aceite; teto de números de WhatsApp em `channel-sessions`, `channels/official`, `partner` e `graph-partner` (reativar arquivado conta). Organização nova nasce com o pacote escolhido; card "Pacote" no admin (`GET/PATCH /api/v1/admin/tenants/[id]/subscription`, só escopo `full`); catálogo público `GET /api/v1/plans` (60/min por IP; sem IP não limita). Diferença do fork: organização SEM assinatura não é bloqueada (falha aberta), e o limite falha aberto se a consulta falhar | 9004 |
| 2026-10-01 | Administração da organização pelo painel (porte do `b1b1eb812`, refeito sobre o convite do upstream): editar nome, nome legal, NUIT (na coluna `cnpj` do upstream, 9 dígitos) e slug; apagar só organização sem uso (confirmação pelo slug; o vínculo provisório do criador não conta; senão 409 "suspenda"); card "Responsável" com convidar/reenviar/trocar e-mail (`/api/v1/admin/tenants/[id]/owner`, revoga o convite do e-mail errado). A criação passa a gravar o convite do dono em `team_invites` — no upstream ele não tinha linha, não aparecia na Equipe e não podia ser revogado. Sem o `reset_password` do fork: o ecrã de entrada já recupera a palavra-passe | — |
| 2026-10-01 | Provedores de IA extras: NÃO portados como provedores próprios. NVIDIA, Groq, Qwen, Zhipu e Moonshot falam a API da OpenAI num endereço público, que o "Provedor personalizado" do upstream já executa (régua anti-SSRF, teste em `/models`, lista de modelos do próprio endpoint). Entrou só a lista que PREENCHE o endereço (`lib/ai/pontos/enderecos-conhecidos.ts`, seletor em IA › Credenciais). Ollama/9Router em `localhost` ficam fora de propósito: com várias organizações por instalação, abrir a rede interna à credencial de uma delas é SSRF; exposto em https público, entra digitado | — |
| 2026-10-01 | Motor do agente: janela de cortesia 6h-23h (disparo e resposta; o upstream usa 7h-22h), domingo aberto (já era o padrão do upstream); frase da tela de guardrails pelo registro de frases; teste próprio contra um merge que devolva 7h-22h. NÃO reaplicados por o upstream já os resolver: retry quando o pacing veta (o upstream reagenda o MESMO turno para a próxima abertura e abre alerta crítico se a mensagem parece urgente) e o hold `go_live` que travava respostas (no upstream ele só retém follow-up proativo; responder sai) | — |
| 2026-10-01 | Inbox: tiques de leitura na bolha do CLIENTE (porte do `bcb34686c`). O `mark-read` do upstream, que só zerava o contador, passa a gravar `read_at` nas recebidas ainda não lidas (`lib/inbox/leitura-das-recebidas.ts`, client da sessão sob RLS); responder também marca. Dois tiques neutros = "Recebida", verdes = "Lida pela equipa" (o azul continua sendo o ack do WAHA). Sem rota paralela nem auditoria por abertura (o upstream não audita o mark-read) | — |
| 2026-10-01 | Decisões do dono, mantendo o upstream: canal novo nasce em "IA em modo de teste" (`pre_go_live`; libera-se em Conexões) e o warm-up do dia 0 fica em 20 mensagens/dia (o fork tinha 50) | — |
| 2026-10-01 | Deploy em Docker Swarm (Portainer + Traefik): `docker-compose.swarm.yml` REFEITO a partir do compose de produção atual (o do fork listava variáveis à mão e já estava velho) — cada serviço lê o `.env` inteiro por `env_file` (`stack.env` do Portainer ou `.env` pelo script), imagens nossas obrigatórias e pinadas, sem caddy/voz/telefonia (o stack deploy ignora profiles), WAHA preso ao nó manager, app com atualização start-first e rollback. `hostgator-setup-kit/deploy-swarm.sh` (substitui o `deploy-swarm-latest.sh` do fork): backup → código na tag → banco (`reaplicar_baseline`, baseline + songhai.sql) → imagens da mesma versão → stack deploy → 307; `--so-banco` para quem troca imagens pelo Portainer. Teste próprio prende o arquivo ao compose de produção | — |
| 2026-10-03 | **Merge do upstream até `fa0587247`** (+108 PRs desde a v1.69.0). Migrations da distribuição renumeradas para a faixa **9001–9004** (o upstream tomou 0501–0504). Regras de resolução do dono: valores sempre de Moçambique (moeda, fuso, idioma, feriados), Maputo padrão e primeiro na lista de fusos, acréscimos do SonghaiCRM preservados. Entrou: suspensão de organização que cala IA/envios/API, prazos de protecção de dados em dia civil (feriados de MZ mantidos), perfil de país **Portugal** (decisão do dono; BR continua fora), lista única de fusos (sem fusos do Brasil), conversões Meta por etapa, assinatura nas mensagens, inglês escondido (`em_construcao`). Corrigido no que entrou sem conflito: idioma de reserva `pt-BR` → `pt-MZ` em 8 rotas, exemplo de moeda para a IA em MTn, NUIT na ferramenta MCP de contactos, alerta do painel sem a sigla LGPD | 9001–9004 |

## Próximo merge do upstream — como retomar

O último merge foi em 2026-10-03 (linha da tabela acima). Para o seguinte:

```bash
git fetch upstream                                    # demora (repositório grande)
git log --first-parent --format='%h %ad %s' --date=short HEAD..upstream/main
git merge-tree --write-tree --name-only HEAD upstream/main   # conflitos, sem tocar na árvore
```

Regras de resolução (decisão do dono, 2026-10-03): **valores sempre de
Moçambique** (MZN, `Africa/Maputo`, `pt-MZ`, feriados de MZ, NUIT); **Maputo é o
padrão e o primeiro** em toda lista de fusos; **os acréscimos do SonghaiCRM
ficam** (PaySuite, licença, administração, tiques, localização…). Depois do
merge, o checklist de `songhai-diferencas-do-upstream.md` e a varredura das
linhas acrescentadas por `?? "pt-BR"`, `"BRL"`, `R$`, `+55`, `Sao_Paulo`.

O dono prefere **um único commit por publicação** — o merge leva junto as
correções da distribuição.

## A reaplicar do fork antigo (`integracao/2026-09-30`)

Em ordem. Cada item cita os commits do fork que servem de referência.

1. **Marca SonghaiCRM**: nome, logo, paleta verde-WhatsApp (`659e294c2`, `87ea9f86d`, `1dcd78899`) — pelo sistema de marca própria do upstream (banco/`.env`), não por código.
2. **PaySuite** (M-Pesa, e-Mola, cartão): cobrança do lead, webhook, tela de integração (`e768805e0`, `aaade44d9`).
3. **Licenciamento por tenant**: ✅ planos, assinaturas e limites (9004). ✅ admin de tenants do `b1b1eb812` (editar, apagar, responsável).
4. **Provedores de IA extras**: ✅ pelo provedor personalizado do upstream + endereços conhecidos (ver tabela).
5. **Motor do agente**: sem gate de go-live (`ddd1fb65c`), retry quando o pacing veta (`3fe51af3f`, `8ef5a68e1`), janela de cortesia 6h–23h com domingo aberto (`a03ffd56d`) — conferir o estado do upstream antes.
6. **Segurança que o upstream ainda não tem**: convite sem segredo falha fechado (`94b09200b` — o upstream ainda tem `dev-fallback`), rate limit em MCP/internal/cron + scan de segredo no pre-commit (`13ecac624`), `organizations.legal_name` nullable (`abe7dfbfe`).
7. **Kit de instalação**: ✅ chave de IA opcional (já no upstream), repositório e imagens da Songhai, deploy em Swarm (refeito).
8. **Inbox**: ✅ ticks de leitura (ver tabela).

## Desligado, não portado (Brasil)

Honorários, Nuvemshop, CRM B2B com BrasilAPI/CNPJ (fica desligado; adaptar a NUIT se houver
cliente B2B), RD Station/Respondi, espanhol, licenciamento do upstream.
