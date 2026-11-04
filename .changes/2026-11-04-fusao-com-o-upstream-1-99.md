---
impacto: capacidade_nova
secao: adicionado
titulo: Fusão com o upstream v1.99: modelos Claude 5.5, reações, localização e mais
---

A SonghaiCRM junta-se ao DeskcommCRM v1.99, mantendo a identidade de Moçambique (metical, fuso `Africa/Maputo`, NUIT, português de Moçambique). Entram, entre outras, as reações e a localização no WhatsApp, os modelos Claude 5.5 com esforço por agente, os limites de plano, a edição e eliminação de organizações no painel e o novo recetor de subscrições. As ferramentas novas do agente ficam ligadas ao pacote (por exemplo, propor campos a partir de um documento é do CRM).

Quem atualiza não tem de editar nada à mão. O banco aplica as 191 migrations novas pelo `update.sh`, e o `docker-compose.swarm.yml` acompanha o de produção (assinatura do webhook do WAHA com `WHATSAPP_HOOK_HMAC_KEY`).
