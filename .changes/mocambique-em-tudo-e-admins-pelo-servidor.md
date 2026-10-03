---
impacto: capacidade_nova
secao: adicionado
titulo: Administradores da plataforma geridos pelo servidor, aviso de logo sem transparência e Moçambique em todos os textos
---

- **Administradores da plataforma sem SQL**: `bash hostgator-setup-kit/platform-admin.sh listar`, `adicionar <email> [total|leitura]`, `retirar <email>` e `exigir-mfa <email> sim|nao`. A pessoa precisa de já ter conta; o script recusa retirar o último administrador com acesso total e deixa cada operação no registo de auditoria.
- **Logo sem fundo transparente**: ao enviar um logo em Marca, o ecrã avisa quando o ficheiro não tem nenhum pixel transparente — é o que faz aparecer um retângulo em volta do logo sobre fundos de outra cor.
- **Proteção de Dados, não LGPD**: os e-mails ao titular e os alertas de prazo citam a Lei n.º 3/2017 (Moçambique) em vez da lei brasileira; títulos, separadores e avisos dizem «Proteção de Dados».
- **Exemplos de Moçambique**: os campos de telefone mostram +258 84 123 4567 (incluindo o emparelhamento do WhatsApp), e o assistente de propostas escreve os preços em meticais.
- **Limites contra abuso**: `/api/v1/health` aceita 30 chamadas por minuto por IP. Na instalação em Docker Swarm, o Traefik ganha limites de pedidos e de ligações por IP, contados pelo IP que a Cloudflare envia — desligados por padrão; ligam-se no `.env` (`TRAEFIK_MIDDLEWARES_DO_APP=deskcomm-limite,deskcomm-ligacoes,deskcomm-compress`) depois de pôr a Cloudflare à frente. Não substitui a proteção de rede contra DDoS.
- Atualização do DeskcommCRM com 108 melhorias (suspensão de organização que cala a IA e os envios, prazos de proteção de dados contados em dia civil, conversões da Meta por etapa, assinatura nas mensagens, entre outras), com os valores de Moçambique preservados.

Não é preciso fazer nada na instalação além da atualização habitual.
