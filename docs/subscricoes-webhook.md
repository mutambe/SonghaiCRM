# Subscrição dos tenants por webhook (SonghaiCRM)

Contrato de `POST /api/v1/webhooks/subscricoes`. Código: `app/api/v1/webhooks/subscricoes/route.ts`,
`lib/subscricoes/evento.ts` (contrato puro) e `lib/subscricoes/servico.ts` (execução). Teste:
`tests/unit/subscricoes-webhook.test.ts`.

## Ligar

No `.env` da VPS:

```bash
SUBSCRICOES_WEBHOOK_SECRET=$(openssl rand -hex 32)   # 32+ caracteres; vazio = rota desligada (404)
SUBSCRICOES_WEBHOOK_ATOR_EMAIL=                       # opcional: admin da plataforma que figura como autor
```

Reinicie o `app`. O mesmo segredo vai para o site (songhai.cc) ou para o processador de pagamento.

## Assinar

`X-Signature` = HMAC-SHA256, em hexadecimal, do **corpo cru** com o segredo. Sem o cabeçalho ou com
assinatura errada: `401`. Exemplo:

```bash
corpo='{"event":"subscription.created","event_id":"evt_20261102_0001","occurred_at":"2026-11-02T10:00:00+02:00","data":{"plan":"agente_medio","organization":{"display_name":"Clínica Sol","legal_name":"Clínica Sol, Lda","nuit":"400123456"},"owner":{"email":"dono@clinica.co.mz"}}}'
sig=$(printf '%s' "$corpo" | openssl dgst -sha256 -hmac "$SUBSCRICOES_WEBHOOK_SECRET" -hex | sed 's/^.* //')
curl -X POST https://crm.exemplo.co.mz/api/v1/webhooks/subscricoes \
  -H "Content-Type: application/json" -H "X-Signature: $sig" --data "$corpo"
```

## Eventos

| `event` | `data` | Efeito |
|---|---|---|
| `subscription.created` | `plan` (`agente_simples` \| `agente_medio` \| `agente_avancado` \| `enterprise`), `organization.display_name` (+ `slug`, `legal_name`, `nuit` opcionais), `owner.email`, opcionais `agreed_price_cents`, `agreed_setup_cents`, `is_pilot` | Cria a organização, põe o pacote como assinatura vigente e envia o convite de administrador ao dono. `201` ao criar, `200` no reenvio. |
| `subscription.plan_changed` | `organization_slug`, `plan`, `notes?` | Troca o pacote (`fn_trocar_plano_da_organizacao`). |
| `subscription.cancelled` | `organization_slug`, `reason` (10–500) | Suspensão administrativa, reversível (`fn_suspender_organizacao`). Nada é apagado. |

Todos levam `event_id` (8–120 caracteres, a chave de idempotência) e, opcionalmente, `occurred_at`
(ISO-8601 com fuso; fora de ±10 minutos o evento é recusado com `400`).

## Garantias

- **Idempotência**: o mesmo `event_id` nunca cria duas organizações — a chave de `fn_create_tenant_with_owner` deriva dele. O convite do dono não é reenviado no reenvio.
- **Slug**: ausente, é derivado do nome; se já existir, tenta uma vez com sufixo. Slug pedido que colide devolve `409`.
- **Organização**: nos eventos que a nomeiam, vem do `organization_slug` do corpo assinado; nunca de um id.
- **Auditoria**: `tenant.created_by_subscription_webhook`, `tenant.subscription_changed`, `tenant.suspended_by_subscription_webhook`, com o `event_id`.
- **Quem age**: o administrador da plataforma indicado (ou o mais antigo com acesso total). Sem nenhum, `500` e nada é criado.
- Os preços e o que cada pacote inclui são os do catálogo `plans` (ver `docs/upstream-sync.md`, 2026-11-02).

## Fora do âmbito

Não cobra nem confirma pagamento: a confirmação da fatura continua a ser o webhook do PaySuite
(`/api/v1/webhooks/payments/paysuite/[token]`). Reativar uma organização cancelada é pelo painel
(`/admin/tenants/[id]`).
