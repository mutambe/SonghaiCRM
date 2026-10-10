---
impacto: exige_acao
secao: adicionado
titulo: Cada pacote passa a incluir só as suas funcionalidades
---

Até aqui o plano de uma organização limitava só utilizadores e números de WhatsApp. Agora `plans.limits.features` diz o que o pacote inclui além do agente de IA e do WhatsApp: o Simples não traz nada extra; o Médio traz agenda, CRM e funil, qualificação de leads e relatórios; o Avançado soma analytics, integrações e M-Pesa; o Enterprise (sem a chave) traz tudo. O que o pacote não inclui some do menu, do hub e do ⌘K, responde 403 `plan_feature_required` na API (sessão e token `dsk_`), sai das ferramentas do agente de IA e, na tela, mostra um aviso a dizer qual pacote traz a funcionalidade. A entrada do WhatsApp (webhooks do WAHA e do Meta), a Inbox e os contactos nunca são bloqueados.

## Requer atenção

As organizações que já tenham assinatura passam a seguir o pacote dela — confira em Admin › Organizações o plano de cada uma antes de atualizar. Organização sem assinatura continua sem bloqueio. Nenhum dado é apagado ao baixar de pacote: a funcionalidade só fica indisponível e volta inteira quando o plano sobe. A migration só preenche onde a chave `features` ainda não existe, e não desfaz ajuste feito à mão.
