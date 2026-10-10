---
impacto: capacidade_nova
secao: adicionado
titulo: Aplicar um agente-modelo a um cliente, em um clique
---

Quem opera vários clientes tinha de montar o agente de cada um à mão. Agora, na página do cliente do painel da plataforma, o cartão **Agente-modelo** copia para ele a versão **publicada** de um agente guardado noutra organização (por exemplo uma organização «Modelos», com um agente por nicho). A cópia nasce como rascunho, com a sessão de WhatsApp do próprio cliente, e nada vai ao ar sozinho: quem revê e publica é o operador.

Tudo o que pertence ao modelo fica para trás — a chave de IA, os funis, a base de conhecimento e as ligações de follow-up —, e a tela diz o que ainda falta configurar no cliente. Cliente sem WhatsApp ligado não recebe a cópia. Cada agente criado guarda de que modelo e de que versão nasceu (`ai_agents.source_agent_id` e `source_version_id`), e a aplicação fica registada na auditoria (`ai_agent.model_applied`). Rota: `POST /api/v1/admin/tenants/[id]/package`.
