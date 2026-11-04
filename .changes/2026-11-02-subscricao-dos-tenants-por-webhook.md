---
impacto: capacidade_nova
secao: adicionado
titulo: Subscrição dos tenants por webhook — o site cria, muda e cancela o pacote
---

O site (songhai.cc) ou o processador de pagamento passa a poder contratar um pacote **sem ninguém abrir o painel**: `POST /api/v1/webhooks/subscricoes`, assinado com HMAC-SHA256 (`X-Signature`). Três eventos: `subscription.created` (cria a organização, põe o pacote como assinatura vigente e envia o convite ao dono), `subscription.plan_changed` (troca o pacote) e `subscription.cancelled` (suspende a organização — reversível, nada é apagado).

Está **desligado por omissão**: sem `SUBSCRICOES_WEBHOOK_SECRET` (32 ou mais caracteres, `openssl rand -hex 32`) no `.env`, a rota responde 404. O `event_id` torna o reenvio idempotente, `occurred_at` fora de ±10 minutos é recusado e tudo fica na auditoria (`tenant.created_by_subscription_webhook`). Usa as mesmas funções do administrador da plataforma; o autor registado é o administrador indicado em `SUBSCRICOES_WEBHOOK_ATOR_EMAIL` ou, sem ele, o mais antigo com acesso total. Contrato e exemplo em `docs/subscricoes-webhook.md`.

Também: os preços dos pacotes passam a ser os de songhai.cc/precos — Agente Simples 7.000, Médio 12.000 e Avançado 18.000 MZN por mês (antes 5.000, 8.000 e 12.000), com **1 número de WhatsApp incluído em todos**. Só muda onde o valor ainda era o da semente anterior; preço acordado por cliente e valores editados pelo administrador ficam como estão.
