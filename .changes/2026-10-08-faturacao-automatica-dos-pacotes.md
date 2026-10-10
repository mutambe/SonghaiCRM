---
impacto: exige_acao
secao: adicionado
titulo: Faturação automática dos pacotes, com preços globais e por cliente
---

A mensalidade de cada cliente passa a ser facturada sozinha. De hora a hora o sistema emite a factura do período seguinte (5 dias antes), cria o link de pagamento no PaySuite (M-Pesa, e-Mola ou cartão), confere o que já foi pago, lembra no vencimento, avisa aos 3 dias de atraso e suspende aos 7 — só se o aviso final saiu há pelo menos 48 horas — e reactiva a conta sozinho assim que o pagamento entra. O dono da empresa vê o aviso no topo da aplicação, a página **Facturação** com as facturas e o botão «Pagar agora», e recebe o mesmo por e-mail quando o e-mail está configurado. Nada disto exige que alguém se lembre de alguma coisa.

Os preços mudam sem mexer no que já foi cobrado: o **preço de cada pacote** e o **preço padrão de cada extra** são globais (Admin › Faturação) e valem para os clientes sem preço acordado a partir da próxima factura; cada cliente pode ter o seu **preço acordado**, o seu **piloto** (setup grátis e 50% na primeira mensalidade, aplicados pelo sistema na primeira factura) e **extras** — por exemplo um número de WhatsApp a mais, que sobe o limite do cliente na hora e entra na factura seguinte. Factura emitida nunca muda. O que cada pacote **inclui** (funcionalidades e limites de utilizadores e de números de WhatsApp) também se edita na mesma tela — e esse vale já, para todos os clientes do pacote, com confirmação que diz quantos são.

A transferência bancária também é aceite: os dados do banco que o operador escreve aparecem nas facturas, nos e-mails e na página do cliente, e uma pessoa dá a factura como paga quando o dinheiro entra (reactiva a conta e agradece, como no PaySuite).

A **quota de tokens de IA** é por conta de WhatsApp: cada pacote define os tokens por mês por conta (um número de WhatsApp a mais sobe a quota), cada cliente pode ter uma quota acordada só dele, e ela renova com o ciclo de facturação. Aos 80% e ao atingir o limite, o cliente (e-mail e aviso no topo da aplicação) e o fornecedor são avisados, uma vez cada por período. Só avisa; não corta o serviço.

## Requer atenção

A faturação vem **desligada**. Para a ligar: em Admin › Faturação escolha a organização que recebe (a que tem o PaySuite configurado em Integrações › PaySuite) e carregue em «Ligar faturação». A data de ligação fica gravada: períodos que começaram antes dela **não** são cobrados, para ligar isto numa instalação com clientes antigos não fazer chover facturas do passado. Os extras do catálogo (número de WhatsApp adicional, integração com CRM, integração com ERP, agente adicional) vêm **sem preço** — defina-os na mesma tela antes de os vender; extra sem preço não se contrata. Organização sem pacote, ou com pacote «sob consulta» e sem preço acordado, não é facturada.
