# Faturação dos pacotes — guia do operador

> Para quem opera o SonghaiCRM e cobra os clientes. O desenho de código está em
> `lib/billing/`; o que importa aqui é **o que se faz** e **o que o sistema faz sozinho**.

## O que corre sozinho

De hora a hora (`api/v1/cron/billing`), sem ninguém tocar em nada:

| Quando | O que o sistema faz |
|---|---|
| 5 dias antes do período | Emite a factura e cria o link de pagamento (M-Pesa, e-Mola, cartão). Avisa o dono do cliente por e-mail e no topo da aplicação |
| No vencimento | Lembrete |
| 3 dias de atraso | **Aviso final**, com a data exacta da suspensão |
| 7 dias de atraso | **Suspende** — só se o aviso saiu há 48 h ou mais. Nunca se suspende quem não foi avisado |
| Pagamento entra | Dá a factura como paga (webhook do PaySuite **ou** consulta de hora a hora — se o webhook falhar, a consulta apanha) e **reactiva a conta sozinha** |
| Pagamento falha | O link morto é largado e um novo nasce na mesma rodada |

A primeira factura de um cliente inclui o setup e dá 5 dias para pagar. Se o cliente é **piloto**, o
sistema tira o setup e 50% da primeira mensalidade (4.000 em vez de 11.000 MZN no pacote Médio) —
uma vez só, na primeira factura.

## Ligar (uma vez)

1. Dentro da **organização da Songhai**, configure o PaySuite em *Integrações › PaySuite*. É com essa conta que se recebe.
2. Em **Admin › Faturação** escolha essa organização em «Quem recebe» e carregue em **Ligar faturação**.

Sem isto a faturação está desligada: nada se emite, nada se suspende. A data de ligação fica gravada —
períodos que começaram **antes** dela não são cobrados, para ligar isto com clientes antigos não fazer
chover facturas do passado.

Para o e-mail sair é preciso um transporte configurado (SMTP ou Resend). Sem ele a faturação funciona na mesma:
o cliente vê o aviso no topo da aplicação e na página *Facturação*.

## Mudar preços

Quatro níveis, e **nenhum toca em factura já emitida** (o conteúdo do pacote, sim, vale já — ver a primeira linha):

| Quero mudar… | Onde | Vale para |
|---|---|---|
| O que um pacote **inclui** (funcionalidades, utilizadores, números de WhatsApp) | Admin › Faturação › *O que cada pacote inclui* | **Já**, todos os clientes do pacote. A tela pede confirmação e diz quantos são. Nenhum dado se apaga: o que sai só fica indisponível |
| O preço de um pacote | Admin › Faturação › *Preço dos pacotes* | Todos os clientes **sem preço acordado**, a partir da próxima factura. A tela diz quantos |
| O preço padrão de um extra | Admin › Faturação › *Extras* | Contratações futuras desse extra |
| O preço de **um** cliente | Página do cliente › *Preço e extras* › Mensalidade acordada | Só esse cliente. «Voltar ao preço do pacote» desfaz |

## Extras (um número de WhatsApp a mais, etc.)

Na página do cliente › *Preço e extras* › **Contratar extra**. O preço vem do catálogo e pode ser
alterado **só para esse cliente**. O que acontece, sem segundo passo:

- o **limite do cliente sobe na hora** (um WhatsApp extra passa o teto de 1 para 2);
- o preço entra na **factura seguinte**, todos os meses (ou uma vez, se for pontual);
- **Terminar** o extra faz o limite descer e deixa de ser cobrado a partir do período seguinte.

Os extras do catálogo vêm **sem preço**: o site só dá intervalos. Defina-os em Admin › Faturação
antes de os vender; extra sem preço não se contrata.

## Tokens de IA por conta

O site promete a cada pacote uma quantidade mensal de tokens, ligada a cada conta de WhatsApp. O sistema mede e avisa:

| O quê | Onde se define |
|---|---|
| **Tokens por mês, por conta de WhatsApp**, de cada pacote | Admin › Faturação › *O que cada pacote inclui* (vazio = sem limite e sem aviso) |
| **Quota acordada só com um cliente** | Página do cliente › *Tokens de IA neste período* (vazio = vale a do pacote) |
| **Quem recebe os avisos do fornecedor** | Admin › Faturação › *Avisos para si, como fornecedor* (vazio = os administradores da plataforma) |

- **A conta:** quota = tokens por conta × contas de WhatsApp contratadas. Um número de WhatsApp a mais (extra) **sobe a
  quota na hora**. A quota acordada com o cliente vence a do pacote.
- **Renova com a conta:** o período é o ciclo de facturação do cliente, não o mês do calendário.
- **Conta:** tokens de entrada + saída das chamadas de IA. O cache de prompt não conta.
- **Avisos, uma vez cada por período:** aos **80%** e ao **atingir o limite**, por e-mail, ao cliente e a si, e
  um aviso no topo da aplicação do cliente. Se o consumo salta de 50% para 120% numa hora, sai uma só mensagem (a do limite).
- **Só avisa. Não corta o serviço.** Para cortar existe o orçamento em dinheiro (Uso › orçamento), que é outra régua
  e outra decisão. O cliente vê o consumo em *Facturação*; você vê todos em Admin › Faturação › *Consumo de tokens de IA*.

## Pagamento directo (transferência e números de recepção)

O PaySuite confirma sozinho M-Pesa, e-Mola e cartão. A transferência entra no banco, onde o sistema não vê:

1. **Quando precisar:** em Admin › Faturação › *Dados para pagamento directo*, escreva os dados do banco (banco, titular,
   NIB/IBAN) e os números de recepção de M-Pesa e e-Mola. É texto livre: altere-o sempre que mudar. Aparecem nas facturas, nos e-mails que pedem pagamento, na página de facturação do cliente e na tela de
   conta suspensa.
2. **Quando o dinheiro entrar:** na página do cliente › *Facturas* › **Marcar como paga (transferência)**. Pede
   confirmação. Faz exactamente o que o PaySuite faz — reactiva a conta se estava suspensa, agradece ao cliente, regista
   na auditoria quem a marcou — e a factura passa a constar como paga por transferência.

É o único passo manual da cobrança, e não há forma de o evitar: só o banco sabe que o dinheiro entrou.

## O que o sistema não faz

- **Não calcula proporcional.** Um extra contratado a meio do mês é cobrado inteiro na factura seguinte.
- **Troca de pacote não reabre o setup** nem muda o dia do ciclo: o ciclo é da organização.
- **Não emite nota fiscal.** A factura do sistema é o pedido de pagamento.
- **Dar prazo e anular** são decisões suas, uma factura de cada vez; o sistema nunca perdoa nada sozinho.
- **Suspensão administrativa é de uma pessoa:** a régua nunca a sobrepõe, e o pagamento nunca a levanta.
- **Pacote «sob consulta» sem preço acordado não é facturado** (fica isento até lhe dar um preço).

## Quando algo parece errado

| Sintoma | Ver |
|---|---|
| Cliente pagou e a conta continua suspensa | A rodada é de hora a hora; se passou mais de uma hora, confira se o PaySuite da organização que recebe está configurado (Admin › Faturação mostra) |
| Factura sem link de pagamento | O PaySuite estava fora ou não está configurado; o link nasce na rodada seguinte assim que estiver |
| Ninguém recebe e-mail | Falta SMTP/Resend. O aviso na tela funciona sem ele |
| Cliente pagou directamente | Página do cliente › *Facturas* › **Marcar como paga (transferência)** (ver a secção acima) |
| Cliente pede mais prazo | Página do cliente › *Facturas* › **Dar prazo** (até 60 dias de cada vez). A régua dessa factura recomeça do zero e, se a conta estava suspensa por essa dívida, volta na hora. **Anular** serve para engano ou acordo |
