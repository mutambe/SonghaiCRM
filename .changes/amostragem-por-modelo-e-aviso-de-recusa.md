---
impacto: nada_mudou
secao: corrigido
titulo: Os modelos novos da Claude deixam de falhar por temperatura, e o sistema avisa quando um modelo recusa os pedidos
---

Os modelos novos da Anthropic (Haiku 5.5, Sonnet 5.5, Opus 5.5 e os seus contemporâneos) recusam qualquer `temperature`, `top_p` ou `top_k` fora do padrão: a chamada inteira devolve erro. O motor dos agentes mandava o que estivesse configurado na organização, e o clima da conversa mandava sempre `temperature: 0`, de modo que escolher um desses modelos para o clima deixava todas as medições a falhar sem nenhum sinal. Agora só os modelos antigos que ainda aceitam recebem esses parâmetros. Nos novos eles são retirados do pedido, e quem administra recebe um aviso na Central dizendo que isso aconteceu e que nada foi alterado no modelo.

O clima passa a pedir ao modelo novo uma resposta estruturada e um esforço baixo, em vez de forçar uma ferramenta que o Opus 5.5 recusa, e com um limite de saída maior para o pensamento não cortar a resposta.

Se o provedor recusar os pedidos feitos a um modelo escolhido pela pessoa (em IA › Provedores ou no agente), a Central abre um aviso, uma só vez enquanto ele estiver aberto, com o caminho para corrigir. Ao escolher um modelo que recusa a afinação que a organização tem configurada, a tela avisa na hora, sem bloquear. O sistema nunca troca de modelo sozinho.

Corrigido também: o campo «Esforço» do agente agora é guardado quando se salva, reverte ou duplica o agente, e o aviso de troca de modelo sai também pela tela, não só pela API.

Os agentes que usam o Claude Haiku 5.5, o Opus 5 ou o Opus 5.5 deixam de ter a resposta cortada aos 4096 tokens (o limite que o sistema assumia para esses modelos, que o pensamento também consome), e o pedido de fecho de cada atendimento deixa de reenviar o raciocínio do modelo, que os modelos novos recusam quando o pedido muda em relação ao anterior.
