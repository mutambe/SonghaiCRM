# Pacote do agente comercial da Songhai

> Para colar nas telas do SonghaiCRM, na organização **da própria Songhai**. Tudo o que está aqui
> sai do site (songhai.cc, lido a 08/10/2026) e das suas respostas de 09/10/2026. O que ainda não se sabe
> está em **Perguntas em aberto**, no fim — não foi inventado.
>
> Método: `deskcomm-cliente-novo`. Fica tudo em **rascunho**; testa-se com o botão *Testar*; o clique
> em *Publicar* é seu.

## 1. O negócio, em resumo

- **O que é:** agência de IA e automação de Maputo. Cria agentes de IA que atendem clientes, qualificam
  contactos e automatizam tarefas repetitivas, 24 horas por dia.
- **Quem compra:** donos e gestores de PMEs, startups e instituições, em saúde, construção, retalho,
  advocacia, educação, agricultura e sector público.
- **Horário da equipa:** segunda a sexta 9h–17h; sábado 9h–14h.
- **Contactos:** WhatsApp +258 84 898 6002 · info@songhai.cc · Praceta dos Namarais, n.º 63, Maputo.
- **Prazos de implementação:** Simples 5–7 dias úteis; Médio e Avançado 2–4 semanas.
- **Fuso:** Africa/Maputo (UTC+2, sem horário de verão).

## 2. Funil «Clientes Songhai»

Etapas, por ordem (exactamente uma «ganhou» e uma «perdeu»):

| # | Etapa | Passo do agente |
|---|---|---|
| 1 | Novos contactos | novo |
| 2 | Já respondi | contactado |
| 3 | A perceber o negócio | qualificando |
| 4 | Conversa marcada | qualificado |
| 5 | Proposta enviada | — (sem passo do agente: é a equipa que a envia) |
| 6 | A negociar | negociando |
| 7 | **Fechou** | ganhou |
| 8 | **Não fechou** | perdeu |

**Vocabulário:** cliente = *cliente* · negócio = *oportunidade* · ganhou = *fechou* · perdeu = *não fechou*.

**Motivos de perda** (os que valem registar): preço · já tem solução · sem orçamento agora · sector que não
atendemos · deixou de responder.

## 3. Prompt do agente

Cole em **IA › Agentes › (novo) › Prompt**. Não nomeia ferramentas nem mete preços: os preços vivem na
base de conhecimento (secção 4), para haver uma só fonte.

```markdown
# Quem você é
Você é o Idris, o assistente virtual da Songhai, uma empresa de Maputo que põe inteligência artificial a trabalhar
em negócios moçambicanos. Fala com donos de negócio, gestores e responsáveis de instituições que querem
atender melhor, poupar tempo ou organizar a empresa. O seu tom é directo, profissional e cordial: sem
rodeios, e sempre ligado a resultados que se medem (horas poupadas, clientes atendidos, vendas).

# O que a Songhai faz
- Agentes de IA de texto: atendem no WhatsApp, respondem, qualificam e agendam, 24 horas por dia.
- Agentes de IA de voz: fazem chamadas com voz natural para marcações e confirmações.
- Automação de processos e sistemas empresariais (ERP/SaaS) com IA integrada.
- Consultoria: mapeamento do impacto da IA, auditoria de processos, formação em IA e acesso contínuo a
  especialistas.

# O que você faz primeiro
Antes de propor qualquer coisa, perceba o negócio da pessoa, uma pergunta de cada vez:
1. Que negócio tem e quantas pessoas trabalham nele?
2. Onde perde mais tempo ou clientes hoje: a responder mensagens, a marcar, a cobrar, nos relatórios?
3. Por onde falam hoje com os clientes: WhatsApp, chamadas, e-mail?
4. Mais ou menos quantas mensagens ou chamadas recebem por dia?
5. Já usam algum sistema (CRM, facturação, ERP)?

# Como você decide o próximo passo
Você faz todo o atendimento sozinho: responde às dúvidas, explica os pacotes, esclarece e conduz a pessoa
até à decisão.
- Se a pessoa quer atendimento no WhatsApp: diga, em poucas linhas, como o agente ajudaria no caso dela;
  consulte os materiais para indicar o pacote que se encaixa pelo tamanho da equipa; ofereça marcar uma
  conversa com o gerente de clientes e proponha horários livres. Se a pessoa quiser ver o produto a funcionar,
  diga-lhe que já o está a ver: este assistente é um agente da Songhai, a trabalhar no WhatsApp.
- Se quer voz, ERP, várias unidades ou algo à medida: explique o que consta dos materiais, diga que isso se
  desenha caso a caso e ofereça marcar a conversa com o gerente de clientes.
- Se só quer saber preços: dê os valores dos materiais, diga que são «a partir de» e pergunte o tamanho da
  equipa para indicar o pacote certo.
- Se a pessoa quer marcar: ofereça horários livres e confirme só depois de a marcação estar feita.
- Se já é cliente e tem um problema: ouça, registe o que se passa e esclareça o que puder com os materiais.

# Situações
- «É caro»: pergunte quantas horas por mês a equipa gasta hoje nessa tarefa. Só fale do piloto e da
  garantia se a pessoa perguntar por condições, teste ou garantia; nesse caso explique-os como constam dos
  materiais, sem alterar nada.
- «Vou pensar»: pergunte o que falta para decidir, combine quando voltar a falar e registe.
- «Funciona para o meu sector?»: a Songhai trabalha com saúde, construção, retalho, advocacia, educação,
  agricultura, PMEs, startups e instituições públicas. Fora disto, diga que se avalia caso a caso.
- Pagamento: a pessoa pode pagar por M-Pesa, e-Mola ou transferência bancária directa. Quando ela quiser avançar
  para o pagamento, diga que vai passá-la ao gerente de clientes, que trata de tudo, e faça a passagem.
- Pedido sobre outro assunto que não é da Songhai: diga com educação que não é consigo e encerre.

# Limites
Você não fecha valores à medida, não promete prazos além dos que constam dos materiais e não garante
resultados que os materiais não garantem. Você só chama uma pessoa da equipa em duas situações: quando a
pessoa chega ao pagamento, e quando faz uma pergunta ou pede um esclarecimento a que você não consegue
responder com os materiais. Em ambas, diga o que vai acontecer e quem a vai atender.

# Estilo
Mensagens curtas, uma pergunta de cada vez, português de Moçambique, sem jargão técnico. Sem emojis.
```

**Palavras de passagem para humano:** `falar com uma pessoa`, `falar com alguém`, `atendente`. Só o pedido
explícito da pessoa — o resto (pagamento, dúvida que ele não resolve) o próprio agente decide pelo prompt.
Se preferir que nem o pedido explícito passe, tire as palavras.

## 4. Base de conhecimento (IA › Conhecimento › FAQ)

Pares pergunta → resposta, todos tirados do site. Os valores são os do site de hoje; quando o preço
mudar, mude **só aqui**.

| Pergunta | Resposta |
|---|---|
| O que é a Songhai? | Uma agência de IA e automação de Maputo. Criamos agentes de inteligência artificial que atendem clientes, qualificam contactos e automatizam tarefas repetitivas, 24 horas por dia. |
| Que serviços oferecem? | Agentes de IA de texto e de voz; automação de processos; sistemas empresariais (ERP/SaaS) com IA integrada; e consultoria (mapeamento de impacto, auditoria de processos, formação em IA e acesso contínuo a especialistas). |
| Que sectores atendem? | Saúde e clínicas, ferragens e material de construção, retalho e e-commerce, advocacia, educação, agricultura, PMEs e startups, e instituições públicas. |
| Quanto custa um agente de IA? | O Agente Simples custa a partir de 5.000 MZN por mês, com um setup único de 2.000 MZN. O Agente Médio, a partir de 8.000 MZN por mês e setup a partir de 3.000 MZN. O Agente Avançado, a partir de 12.000 MZN por mês e setup a partir de 4.000 MZN. O Enterprise é sob consulta. |
| O que inclui o Agente Simples? | Agente de IA personalizado, 1 número de WhatsApp, o SonghaiCRM (sem agenda), suporte em horário laboral, formação de 2 horas e até 2 ajustes por mês. |
| O que inclui o Agente Médio? | Tudo do Simples, mais a agenda (Google Calendar nativo no SonghaiCRM), integração com CRM externo, qualificação automática de contactos, relatórios diários ou semanais, até 4 ajustes por mês e suporte prioritário com resposta em menos de 2 horas em horário laboral. |
| O que inclui o Agente Avançado? | Tudo dos anteriores, mais integrações múltiplas (CRM, POS, ERP, facturação), processamento de pagamentos M-Pesa, painel de analytics em tempo real, ajustes ilimitados, suporte VIP (resposta em menos de 1 hora em horário laboral e 24/7 para incidentes críticos) e uma reunião mensal de optimização. |
| Para que empresas serve cada pacote? | O Simples serve equipas pequenas; o Médio, PMEs médias; o Avançado, empresas maiores e e-commerce. O Enterprise é para grandes empresas e grupos, com várias unidades, SLA à medida e gestor de conta dedicado. |
| Quanto tempo demora a implementar? | O Agente Simples fica pronto em 5 a 7 dias úteis; o Médio e o Avançado, em 2 a 4 semanas. |
| Posso ver o agente a funcionar? | Já está a falar com um: este assistente é um agente de IA da Songhai, a trabalhar no WhatsApp. Se quiser ver como ficaria no seu negócio, falamos com o gerente de clientes. |
| Há período de teste? | Sim, o piloto: setup grátis e 50% de desconto na primeira mensalidade. |
| Há garantia? | Sim: se não poupar pelo menos 10 horas por mês no primeiro trimestre, devolvemos a diferença em crédito. |
| Há extras? | Sim. Número de WhatsApp adicional: sob consulta. Integração com CRM: 1.000 a 2.000 MZN. Integração com ERP: 2.000 a 5.000 MZN. Agente adicional: 40% do valor do pacote. Tokens adicionais: cobrados por consumo. |
| Como falo com a equipa? | Por WhatsApp no +258 84 898 6002, por e-mail para info@songhai.cc, ou na Praceta dos Namarais, n.º 63, em Maputo. Atendemos de segunda a sexta, das 9h às 17h, e ao sábado, das 9h às 14h. |
| Como posso pagar? | Por M-Pesa, e-Mola ou transferência bancária directa. Quando quiser avançar, passo-o ao nosso gerente de clientes, que trata de tudo consigo. |
| O agente pode processar pagamentos M-Pesa? | Sim, no pacote Avançado, que inclui o processamento de pagamentos M-Pesa. |
| O que são os tokens do pacote? | Cada pacote inclui uma quantidade mensal de tokens, que é o consumo da inteligência artificial. Cada conta de WhatsApp tem a sua própria quantidade, sem partilha entre contas. A quantidade exacta do seu pacote é confirmada pela equipa. |
| Que tecnologias usam? | Integramos WhatsApp, M-Pesa e Google Calendar, e trabalhamos com modelos de IA como OpenAI, Claude e Gemini. |

## 5. Follow-ups (IA › Follow-ups)

Três fluxos. Gatilho → espera → mensagem → condição («se ainda não respondeu») → fim. Publique cada um.

1. **Silêncio** — 24 h depois da última pergunta sem resposta:
   «Olá! Ainda posso ajudar com o que falávamos? Se preferir, diga-me só quantas pessoas tem a equipa e
   indico-lhe o pacote que se encaixa.»
   Segunda tentativa 72 h depois: «Não quero incomodar. Se mudar de ideias, estou por aqui. Quando quiser,
   falamos.»
2. **Proposta enviada, sem resposta** — 3 dias: «Teve oportunidade de ver a proposta? Se ficou alguma
   dúvida, diga-me e resolvemos.» · 7 dias: «Vou deixar isto em aberto. Se quiser retomar, é só escrever. Posso
   perguntar o que pesou na decisão?» (e registar o motivo).
3. **Conversa marcada** — o lembrete do compromisso já é do agendamento; não duplique aqui.

## 6. Memória da organização (IA › Memória)

- A Songhai atende em Moçambique; a equipa trabalha de segunda a sexta, 9h–17h, e ao sábado, 9h–14h.
- Os preços do site são «a partir de»; o valor final é confirmado pela equipa.
- Propostas à medida, Enterprise, voz e integrações com ERP/POS/facturação passam sempre pela equipa.

## 7. Promessas (tabela de promessas)

| O que o agente pode oferecer | Limite |
|---|---|
| Piloto | setup grátis e 50% na primeira mensalidade — **só** o que consta do site |
| Garantia | devolução da diferença em crédito se não poupar 10 h/mês no primeiro trimestre — **só** o que consta do site |
| Qualquer outro desconto | **nenhum** |

## 8. Roteador

Um agente só: **sem roteador**. Crie-o se um dia separar «Comercial» de «Suporte a clientes».

## 9. Roteiro de teste (botão *Testar*)

Para cada mensagem veja: respondeu sem inventar? fez **uma** pergunta? tentou a acção certa? algum portão vetou?

1. «Boa tarde, quanto custa um agente para a minha clínica?» — deve dar os valores do site como «a partir de»
   e perguntar o tamanho da equipa, em vez de despejar tudo.
2. «Têm agenda no pacote mais barato?» — deve dizer que o Simples não inclui a agenda e que ela vem a partir
   do Médio.
3. «Isso é caro, vou pensar.» — deve perguntar o que falta e propor retorno, sem inventar desconto.
4. «Vocês fazem sistemas de contabilidade?» — não consta dos materiais: deve dizer que se avalia caso a caso
   e chamar a equipa, sem prometer.
5. «Quero falar com uma pessoa.» — deve passar para a equipa.
6. «Quanto tempo demora a pôr o agente a funcionar?» — 5–7 dias úteis no Simples; 2–4 semanas no Médio e Avançado.
7. «Posso pagar em 3 prestações?» — não consta dos materiais: não deve prometer; chama a equipa.

## 10. Para aplicar (ordem do guia)

1. **IA › Credenciais** — a chave de IA (ou use a da instalação) e, se não for OpenAI, a da OpenAI para áudio e
   base de conhecimento.
2. **Funil** — as etapas da secção 2, o mapa dos passos do agente, o vocabulário.
3. **IA › Conhecimento** — os pares da secção 4; espere o estado «pronto».
4. **IA › Follow-ups** — os três fluxos da secção 5, publicados.
5. **A agenda do gerente** (para o Idris marcar sozinho):
   - **Agenda › Pessoas**: a pessoa «Phill Muthambe — Gerente de clientes», com o Google Agenda ligado e o
     horário de trabalho dela (seg–sex 9h–17h, sáb 9h–14h, se for o horário do gerente).
   - **Agenda › Tipos**: «Conversa com o gerente», ligada a essa pessoa. A agenda exige uma duração; ponha 30 min e
     altere quando quiser. A demonstração do produto faz-se na própria conta da Songhai, por isso não há tipo de
     compromisso próprio para ela.
   - **IA › Skills**: instalar `agendamento`.
6. **IA › Agentes** — nome *Idris*, prompt da secção 3, canal +258 84 898 6002, funil, conhecimento, follow-ups,
   capacidades de agenda. **Rascunho.**
7. **Avisos de caso** (IA › Aviso no WhatsApp):
   - **Aviso no WhatsApp** — destino **+258 82 446 8532**, rótulo «Phill Muthambe — Gerente de clientes». É o número
     que recebe o aviso quando o Idris passa um caso. O produto guarda **um** destino no WhatsApp; pode alterá-lo
     quando quiser.
   - **Avisar também por e-mail** — a lista de pessoas que recebe o mesmo aviso (até 10 e-mails), em separado do WhatsApp.
8. **Testar** — o roteiro da secção 9, mais: «Quero pagar» (deve passar ao gerente) e «Quero marcar uma conversa»
   (deve propor horários).
9. **Publicar** — o clique é seu. Depois, **IA › Memória** (secção 6).

## 11. Para cada cliente novo (o agente-modelo)

A chave de IA é **do cliente**: uma por tenant, obtida por si no provedor (Claude, OpenAI…), sem partilha entre
clientes. O banco **recusa publicar** uma versão de agente sem credencial validada, por isso a chave vem antes.

1. Crie o cliente (Admin › Tenants › Novo) com o pacote, o preço acordado e o piloto, se for o caso.
2. O cliente liga o seu WhatsApp no onboarding.
3. **A chave de IA do cliente:** obtenha-a no provedor e registe-a em *IA › Credenciais* **dentro do cliente**. O dono do
   cliente também o pode fazer sozinho (a rota exige o papel de administrador do tenant e não depende do pacote), e
   é ele que a gere e substitui depois, sem passar por si.
4. Em Admin › Tenants › *(cliente)* › **Agente-modelo**, aplique o modelo do nicho. Se o cliente já tem a chave do
   provedor registada e validada, o agente liga-se a ela sozinho; senão a lista diz que falta.
5. O resto do que a lista diz (funis, conhecimento, follow-ups), a revisão e a publicação.

## 12. Perguntas em aberto

Respondidas: número comercial (+258 84 898 6002, já ligado); o Idris faz todo o atendimento e só passa ao gerente
no pagamento ou numa dúvida que não resolva; marca na agenda do gerente; piloto e garantia só se perguntarem;
pagamento por M-Pesa, e-Mola e transferência directa; os dados bancários e os números de recepção são seus para
definir (Admin › Faturação › *Dados para pagamento directo*); a quota de tokens de cada pacote é sua para definir
(Admin › Faturação › *O que cada pacote inclui*), com aviso a 80% e ao limite ao cliente e a si; as chaves de API
são obtidas por si nos provedores, uma por cliente, e o dono do tenant gere a dele.

Respondidas também: a demonstração faz-se na própria conta da Songhai (não há compromisso de demonstração
com duração própria); ao atingir o limite de tokens o serviço continua e só avisa; o aviso de caso passa a ir também
por e-mail a uma lista de pessoas, em separado do WhatsApp.

Ainda por responder: nada que bloqueie. Para publicar o Idris faltam só os dados — escrever os dados de pagamento e os
tokens de cada pacote na tela de Faturação, e a chave de IA da Songhai em IA › Credenciais.
