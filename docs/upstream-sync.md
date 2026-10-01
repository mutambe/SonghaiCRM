# SonghaiCRM sobre o DeskcommCRM — sincronia com o upstream

O SonghaiCRM (Songhai, Lda — Moçambique) é o
[DeskcommCRM](https://github.com/melgarafael/DeskcommCRM) (remote `upstream`) com a
identidade moçambicana por cima.

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
| Voz do agente de IA | `lib/agent-engine/playbooks/platform.md` | Camada plataforma em português de Moçambique; instalação existente recebe pela 0502 |
| Banco | `supabase/songhai.sql` | Apêndice aplicado depois do `baseline.sql`; o baseline fica intocado |
| Testes da distribuição | `tests/unit/*.test.ts` próprios | Não editar teste do upstream quando dá para acrescentar |

## Já aplicado nesta base

| Data | O quê | Migration |
|---|---|---|
| 2026-10-01 | Perfil de país MZ; NUIT no documento do titular e na captura de campos do follow-up; feriados MZ no SLA | — |
| 2026-10-01 | Moeda MZN (padrão e moedas servidas); fuso Africa/Maputo; defaults do banco | 0501 |
| 2026-10-01 | Idioma pt-MZ com camada de vocabulário; espanhol e pt-BR escondidos | — |
| 2026-10-01 | Sentry e anonimizador do RAG apagam telefone/NUIT moçambicanos (o padrão do upstream só pegava a forma brasileira) | — |
| 2026-10-01 | Trava de promessas do agente enxerga metical (antes era cega: só real e euro) | — |
| 2026-10-01 | Descrições de ferramenta do agente pedem português de Moçambique, não pt-br | — |
| 2026-10-01 | Camada plataforma do playbook, prompt padrão de agente e prompt de prospecção mandavam escrever "em português do Brasil" — agora português de Moçambique, com vocabulário e construções | 0502 |
| 2026-10-01 | Mensagens fixas ao cliente (agenda, lembrete, 13 mensagens dos modelos de follow-up) reescritas em português de Moçambique; data da reunião com ano de 4 dígitos | — |
| 2026-10-01 | Sexta-feira Santa confirmada como feriado nos prazos (decisão do dono do produto) | — |

## A reaplicar do fork antigo (`integracao/2026-09-30`)

Em ordem. Cada item cita os commits do fork que servem de referência.

1. **Marca SonghaiCRM**: nome, logo, paleta verde-WhatsApp (`659e294c2`, `87ea9f86d`, `1dcd78899`) — pelo sistema de marca própria do upstream (banco/`.env`), não por código.
2. **PaySuite** (M-Pesa, e-Mola, cartão): cobrança do lead, webhook, tela de integração (`e768805e0`, `aaade44d9`).
3. **Licenciamento por tenant**: planos, assinaturas, limites de utilizadores e conexões, admin de tenants (`df5e4ec79`…`a4641c891`, `b1b1eb812`).
4. **Provedores de IA extras**: NVIDIA, Ollama, Qwen, Zhipu, Moonshot, Groq, 9Router (`10118b589`, `c37ff9540`, `aef37efa5`, `39ba4b26f`) — conferir o que o "provedor personalizado" do upstream já cobre.
5. **Motor do agente**: sem gate de go-live (`ddd1fb65c`), retry quando o pacing veta (`3fe51af3f`, `8ef5a68e1`), janela de cortesia 6h–23h com domingo aberto (`a03ffd56d`) — conferir o estado do upstream antes.
6. **Segurança que o upstream ainda não tem**: convite sem segredo falha fechado (`94b09200b` — o upstream ainda tem `dev-fallback`), rate limit em MCP/internal/cron + scan de segredo no pre-commit (`13ecac624`), `organizations.legal_name` nullable (`abe7dfbfe`).
7. **Kit de instalação**: chave de IA opcional no `install.sh` (`591233c4e`), repositório e imagens da Songhai, deploy em Swarm (`63c1ddf4f`, `c4d1661b0`).
8. **Inbox**: ticks de leitura do agente (`bcb34686c`).

## Desligado, não portado (Brasil)

Honorários, Nuvemshop, CRM B2B com BrasilAPI/CNPJ (fica desligado; adaptar a NUIT se houver
cliente B2B), RD Station/Respondi, espanhol, licenciamento do upstream.
