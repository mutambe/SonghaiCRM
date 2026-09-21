a# Como o SonghaiCRM funciona — guia rápido para quem revende/instala

> Resumo prático de quem usa o quê no sistema. Para a doutrina técnica completa, ver [`CLAUDE.md`](../CLAUDE.md); para o modelo de revenda/marca própria, ver [`white-label.md`](white-label.md).

---

## 1. Duas camadas, dois donos

O SonghaiCRM tem **dois ambientes separados**, com login e propósito diferentes:

| | `/app` | `/admin` |
|---|---|---|
| **Quem usa** | O seu cliente (a empresa que comprou/contratou) | Você — quem instalou e vende o sistema |
| **O que gere** | Os leads/clientes *dele* | As organizações (tenants) que você atende |
| **Acesso** | Conta criada no onboarding daquela empresa | Conta do "dono", criada durante o `install.sh` |
| **Aparece no menu?** | Sim, é o produto | Não — é um sub-produto à parte, acessado direto pela URL |

Não confundir os dois: o painel que o seu cliente vê (Inbox, Funis, Contactos, Agentes de IA…) é **o produto que ele usa no dia a dia**. O `/admin` é **o seu backstage**.

---

## 2. `/app` — o que o seu cliente usa

Menu lateral do produto, por bloco:

- **Atendimento** — `Inbox` (conversas de WhatsApp em tempo real, com fila de conversas sem dono, notas internas entre a equipa e transferência/claim de conversa), `Radar` (o que precisa de atenção), `Respostas rápidas` (templates)
- **CRM** — `Funis` (pipeline de vendas), `Contactos`, `Etapas do funil`, `Agenda`
- **Agente de IA** — `Agentes`, `Follow-ups`, `Roteadores` (automação de atendimento)
- **Canais** — `Conexões` (WhatsApp via WAHA), `PaySuite` (pagamento M-Pesa/e-Mola/cartão para os *leads dele*), `Webhooks`
- **Configurações** — `Distribuição de atendimento` (rodízio entre atendentes, restrição de visibilidade por atendente, janela/horário de atendimento)
- **Análise** — `Desempenho`, `Evolução da IA`, `Audit Log`

Fluxo típico de uso: liga o WhatsApp em **Conexões** → mensagens caem na **Inbox**, distribuídas pela fila conforme **Configurações → Distribuição de atendimento** → negócios avançam no **Funil** → acompanha números em **Desempenho**.

---

## 3. `/admin` — o seu painel de controlo

### Como entrar

```
https://<dominio-da-instalação>/admin
```

Login com a conta **dono**, a mesma criada quando rodou o `install.sh` — ela já nasce promovida a *platform admin*, sem passo extra. `/admin/forbidden` significa que a conta usada não tem essa role.

### O que dá para fazer ali

| Tela | Para quê |
|---|---|
| `/admin/tenants` | Lista de todas as organizações (clientes), com filtro por status: `active`, `suspended`, `onboarding`, `redacted` |
| `/admin/tenants/[id]` | Detalhe de uma organização — dados, saúde da instalação, uso |
| Suspender / reativar | Corta ou devolve o acesso de um cliente (ex.: por falta de pagamento) |
| `/admin/usage` | Consumo por tenant |
| `/admin/audit` | Trilha de tudo o que foi feito no `/admin` |
| `/admin/platform-admins` | Conceder acesso de `/admin` a mais alguém da sua equipa |
| `/admin/incidents`, `/admin/lgpd` | Incidentes técnicos e pedidos de titular de dados (LGPD/Lei n.º 3/2017) |

---

## 4. Controlo de assinaturas — o que existe e o que não existe

**Não existe cobrança recorrente automática dentro do sistema.** O modelo de negócio do SonghaiCRM é *self-host*: você cobra o cliente por fora (fatura, transferência, o que preferir) — o software não tem um motor tipo Stripe que cobra e suspende sozinho.

O que existe é o **interruptor manual**: quando um cliente atrasa, você entra em `/admin/tenants/[id]` e suspende (com motivo obrigatório); quando ele paga, reativa. O cliente suspenso vê uma tela própria de "conta suspensa" com o e-mail de suporte que você configurou (`SUPPORT_EMAIL` no `.env`).

> **PaySuite não é para isto.** É a integração de pagamento (M-Pesa/e-Mola/cartão) que aparece dentro do `/app` — serve para os **leads do seu cliente** pagarem um pedido/negócio, não para você cobrar o seu cliente pela assinatura do software.

Se um dia quiser cobrança automática de verdade, isso seria uma feature nova: um webhook do seu gateway de pagamento chamando os endpoints `POST /api/v1/admin/tenants/[id]/suspend` / `reactivate`.

---

## 5. Marca própria (white-label)

Cada instalação pode trazer o **seu** nome, cor e logo — `/admin/marca` para a marca da instalação (o que aparece no login); cada organização pode ainda ter a própria marca dentro do `/app` dela, em `Configurações → Marca`. Detalhe completo em [`white-label.md`](white-label.md).

---

*Este documento é um resumo operacional, não substitui o `CLAUDE.md` nem os docs de referência linkados acima.*
