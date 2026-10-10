# Manual — configurar o Idris, o agente comercial da Songhai

> **Para quem:** o operador da Songhai, sem precisar de programar. Cada passo diz **onde clicar**, **o que
> escrever** e **como saber que ficou certo**.
> **Quanto tempo:** uma tarde, a maior parte à espera de validações (chave de IA, indexação, Google).
> **Os textos** (prompt, respostas, mensagens) estão em dois ficheiros prontos a copiar:
> [`songhai-agente-comercial.md`](songhai-agente-comercial.md) e [`songhai-faq-para-colar.md`](songhai-faq-para-colar.md).
> Este manual diz **como**; aqueles ficheiros dizem **o quê**.

## O que fica a funcionar no fim

O **Idris** atende no WhatsApp **+258 84 898 6002**, 24 horas por dia: responde, explica os pacotes e os preços,
percebe o negócio da pessoa e marca uma conversa na agenda do gerente. Só passa a uma pessoa em duas situações: quando
a pessoa chega ao **pagamento**, ou quando faz uma pergunta que ele não consegue resolver. Nessa altura o gerente
(Phill Muthambe, +258 82 446 8532) recebe um aviso no WhatsApp e, se quiser, por e-mail.

**Regra de ouro:** fica tudo em **rascunho** até você carregar em *Publicar*. Nada vai ao ar sozinho.

---

## Antes de começar — reúna isto

| O quê | Para quê | Onde obter |
|---|---|---|
| Chave de API da **Anthropic** (Claude) | O Idris "pensa" com ela | Painel da Anthropic → API keys. **Uma chave só da Songhai** |
| Chave de API da **OpenAI** | Ouvir áudios e consultar a base de conhecimento | Painel da OpenAI → API keys |
| O WhatsApp **848986002** ligado | O Idris atende por ele | Já está ligado (confirme no passo 1) |
| A conta Google do **gerente** | Para o Idris marcar na agenda dele | Phill Muthambe, com acesso ao Google Agenda |
| Os dois ficheiros de texto acima | Prompt, respostas, mensagens | Estão em `docs/` |

> **A chave de IA é sempre do próprio tenant.** Nunca se partilha uma chave entre organizações. Para a Songhai, a
> chave é da organização Songhai; para cada cliente futuro, uma chave só dele (ver a Parte B).

---

## Parte A — Pôr o Idris a funcionar

Faça os passos **por esta ordem**: cada um depende do anterior (o sistema recusa publicar um agente sem número
ligado e sem chave validada).

### Passo 1 — Confirmar o número (Conexões)

1. Menu **Conexões**.
2. O número **+258 84 898 6002** tem de aparecer com o estado **WORKING**.

✅ **Certo quando:** o estado é *WORKING*. Se estiver noutro estado, reconecte pelo QR com o telemóvel e espere.
⚠️ Se o número estiver em *modo de teste* (lista de telefones autorizados), o Idris só responde a esses números até
alguém o libertar na Central de avisos.

### Passo 2 — A chave de IA (IA › Credenciais)

1. Menu **IA › Credenciais › Adicionar**.
2. Provedor **Anthropic**, nome «Chave principal», cole a chave. Guarde.
3. Repita com o provedor **OpenAI**, nome «OpenAI (áudio e conhecimento)».
4. Espere uns segundos: a validação corre sozinha contra o provedor.

✅ **Certo quando:** as duas aparecem como **validadas**. Só uma credencial validada permite publicar o agente.
❌ **"Recusada":** a chave está truncada ou sem saldo no provedor. Copie-a de novo, inteira.

### Passo 3 — Os modelos (IA › Provedores)

Menu **IA › Provedores**. Deixe o atendimento no **padrão** (um agente novo já nasce com o Claude Haiku 5.5 e esforço
*Médio*, que chega para conversas comerciais). Para o classificador e o follow-up, um modelo barato chega.

> Se depois do teste do Passo 10 achar as respostas fracas, suba o modelo do agente (Passo 8) para o Sonnet 5.5.
> Custa mais por conversa.

### Passo 4 — O funil (Configurações › Etapas do funil)

1. Menu **Configurações › Etapas do funil**: crie um funil novo com o nome **«Clientes Songhai»**.
2. Crie as etapas **por esta ordem** e ligue cada uma ao *passo do agente*:

| Etapa | Passo do agente |
|---|---|
| Novos contactos | novo |
| Já respondi | contatado |
| A perceber o negócio | qualificando |
| Conversa marcada | qualificado |
| Proposta enviada | *(nenhum — é a equipa que a envia)* |
| A negociar | negociando |
| **Fechou** | **ganhou** |
| **Não fechou** | **perdeu** |

3. Marque **exactamente uma** etapa como *ganhou* (Fechou) e **uma** como *perdeu* (Não fechou): o sistema recusa duas.
4. Vocabulário: cliente = *cliente*, negócio = *oportunidade*, ganhou = *fechou*, perdeu = *não fechou*.
5. Motivos de perda: *preço · já tem solução · sem orçamento agora · sector que não atendemos · deixou de responder*.

✅ **Certo quando:** o funil aparece na lista e as 7 etapas com passo do agente têm o passo escolhido.

### Passo 5 — O que o Idris sabe (IA › Conhecimento)

1. Menu **IA › Conhecimento › Adicionar material → FAQ**.
2. Nome: **«Songhai — perguntas frequentes»**.
3. Abra [`songhai-faq-para-colar.md`](songhai-faq-para-colar.md), copie **tudo o que está abaixo da linha** (as 18 perguntas e
   respostas) e cole.
4. Guarde e **espere o estado «pronto»** (a indexação é assíncrona e precisa da chave da OpenAI do Passo 2).

✅ **Certo quando:** o material aparece como **pronto**. ❌ Se ficar parado, falta a chave da OpenAI ou ela não validou.

> **Preços e pacotes vivem aqui, nunca no prompt.** Quando um preço mudar, altere o material (uma só fonte). Se estiver
> também no prompt, o Idris pode contradizer-se.

### Passo 6 — Os follow-ups (IA › Follow-ups)

Crie **dois fluxos** (**Novo fluxo**), com o texto da secção 5 de [`songhai-agente-comercial.md`](songhai-agente-comercial.md):

| Fluxo | Gatilho | Mensagens |
|---|---|---|
| Silêncio | silêncio de 24 h | uma mensagem às 24 h; segunda às 72 h |
| Proposta sem resposta | mudança para a etapa «Proposta enviada» | aos 3 dias; aos 7 dias (e regista o motivo) |

O lembrete da conversa marcada **não** é um fluxo: já é da agenda, e criar outro duplicava a mensagem.

Em cada fluxo: **gatilho → espera → mensagem → condição («se ainda não respondeu») → fim**, com *cancelar quando
responder* ligado. Carregue em **Publicar** no construtor.

⚠️ **Faltam dois passos, senão o fluxo fica vivo na lista e morto no motor:** (1) **Publicar** o fluxo; (2) ligá-lo ao agente
no Passo 8, no campo *follow-ups que arma*. Fluxo em rascunho não corre.

### Passo 7 — A agenda do gerente

É o passo com mais ligações. Faça-o devagar.

**7.1 — Uma vez por instalação (Admin › Google Agenda).** O menu de administração **Google Agenda** tem o formulário do
*app OAuth* do Google (Client ID e Secret, criados na consola do Google). Se o cartão **Agenda** disser que "falta
configurar o Google", é aqui.

**7.2 — O gerente liga a sua conta.** O Phill entra no CRM, abre **Agenda** e carrega em **Conectar Google**, aceitando as
permissões. ✅ O cartão passa a dizer **Agenda conectada**.

**7.3 — O tipo de compromisso.** **Configurações › Tipos de agendamento → Novo**:
- Nome: **«Conversa com o gerente»**.
- **Responsável:** o Phill (sem responsável, o Idris não tem de quem marcar).
- **Duração:** 30 min (a agenda exige uma; altere quando quiser).
- Os horários em que o gerente atende (seg–sex 9h–17h, sáb 9h–14h) são os da disponibilidade dele nesta mesma
  configuração; ajuste-os se a tela os pedir.

**7.4 — A skill.** **IA › Skills → Instalar** `agendamento`.

✅ **Certo quando:** na **Agenda** consegue marcar uma conversa de teste e ela aparece no Google Agenda do Phill.

> A demonstração do produto faz-se na própria conta da Songhai: por isso não há um compromisso de "demonstração" com
> duração própria. O próprio Idris é a prova de que o produto funciona.

### Passo 8 — O agente (IA › Agentes)

**IA › Agentes → Novo agente.** Preencha a aba **Configuração**:

| Campo | Valor |
|---|---|
| Nome | **Idris** |
| Descrição | Assistente comercial da Songhai |
| Prioridade | 0 (só há um agente neste número) |
| **Prompt** | Cole o bloco da **secção 3** de [`songhai-agente-comercial.md`](songhai-agente-comercial.md), **sem alterar** |
| Provedor / modelo | Anthropic · o padrão do Passo 3 |
| **Credencial** | A «Chave principal» do Passo 2 |
| **Número** | +258 84 898 6002 |
| Funis que pode mover | «Clientes Songhai» |
| Materiais que consulta | «Songhai — perguntas frequentes» |
| Follow-ups que arma | Os dois fluxos do Passo 6 |
| Palavras de passagem para humano | `falar com uma pessoa`, `falar com alguém`, `atendente` |
| Casos (abrir demanda para o time) | **Ligado** |
| Dividir mensagens longas | **Ligado** (mensagens curtas, como o prompt pede) |
| Horário de atendimento | Sem restrição (24 h). Pode limitar depois |

Aba **Capacidades:**
- Pacotes: **vender** (traz agenda, conhecimento, notas e funil) e **escalar** (chamar uma pessoa).
- **Capacidades críticas: todas desligadas** (enviar mensagem avulsa, cancelar agenda, fechar caso). O Idris não precisa
  de nenhuma, e cada uma dá-lhe poder para agir sozinho.

**Guardar** cria a **versão 1 em rascunho**.

> **Não escreva preços no prompt, não nomeie ferramentas, não mande "encaminhar ao gerente tudo o que não souber".**
> O sistema já impõe: apresentar-se como assistente virtual, não inventar preço, respeitar quem pede para parar, não
> mandar fora de horas, não confirmar agenda sem a verificar.

### Passo 9 — Os avisos ao gerente (IA › Aviso no WhatsApp)

Menu **IA › Aviso no WhatsApp**:

1. **Aviso no WhatsApp:** número **+258 82 446 8532**, nome «Phill Muthambe — Gerente de clientes», e a conexão
   +258 84 898 6002 como remetente. Ligue.
2. Carregue em **Enviar aviso de teste** e confirme que chegou ao telemóvel do Phill.
3. **Avisar também por e-mail** (mesmo ecrã): escreva os e-mails, um por linha (até 10), e ligue.

✅ **Certo quando:** o aviso de teste chega ao WhatsApp. Para trocar o número depois, é só alterá-lo aqui.
ℹ️ O WhatsApp aceita **um** número; mais pessoas, por e-mail. O e-mail só sai se houver SMTP ou Resend configurado e um
endereço público da instalação (ver **Admin › E-mail**).

### Passo 10 — Testar antes de publicar

Abra a versão em rascunho e use o botão **Testar** (corre o motor real, com uma mensagem e um contacto fictício; gasta
um pouco de crédito de IA). Para cada mensagem veja: respondeu sem inventar? fez **uma** pergunta? tentou a acção certa?

| Escreva | Deve… |
|---|---|
| «Boa tarde, quanto custa um agente para a minha clínica?» | Dar os valores como «a partir de» e **perguntar o tamanho da equipa** |
| «Têm agenda no pacote mais barato?» | Dizer que o Simples não tem agenda e que vem a partir do Médio |
| «Isso é caro, vou pensar.» | Perguntar o que falta e propor retorno, **sem inventar desconto** |
| «Vocês fazem contabilidade?» | Não consta dos materiais: dizer que se avalia caso a caso e chamar a equipa |
| «Quero falar com uma pessoa.» | Passar ao gerente |
| «Quanto tempo demora a pôr o agente a funcionar?» | 5–7 dias úteis (Simples); 2–4 semanas (Médio e Avançado) |
| «Posso pagar em prestações?» | Não prometer: chamar a equipa |
| «Quero pagar.» | Dizer que o gerente trata do pagamento e **passar o caso** |
| «Quero marcar uma conversa.» | Propor horários livres da agenda do gerente |
| «Posso ver o agente a funcionar?» | Dizer que já está a falar com um |

❌ Se um **portão vetar** uma resposta e o veto vier do prompt (jargão, promessa), corrija o prompt no rascunho e teste de novo.

### Passo 11 — Publicar

1. Na versão aprovada, carregue em **Publicar** e confirme. **O clique é seu.**
2. O sistema recusa com um motivo claro se faltar: credencial validada, número *WORKING*, modelo no catálogo ou uma
   capacidade que não existe.
3. Vale no **próximo atendimento**, sem reiniciar nada.

### Passo 12 — A memória (IA › Memória)

Em **Documento da organização** escreva e **Publique a versão**:

> A Songhai atende em Moçambique; a equipa trabalha de segunda a sexta, 9h–17h, e ao sábado, 9h–14h. Os preços do site
> são «a partir de»; o valor final é confirmado pela equipa. Propostas à medida, Enterprise, voz e integrações com
> ERP/POS/facturação passam sempre pela equipa.

### Passo 13 — Confirmar com uma mensagem real

De **outro telemóvel**, escreva ao +258 84 898 6002 («Olá, quanto custa?»). Deve receber a resposta do Idris em segundos.
Depois, em **IA › Casos**, veja a conversa e o caso, se o Idris tiver aberto algum.

---

## Parte B — Cada cliente novo (o agente-modelo)

Para cada empresa que contrata um pacote. Detalhe completo em [`songhai-agente-comercial.md`](songhai-agente-comercial.md) (secção 11)
e [`songhai-faturacao.md`](songhai-faturacao.md).

1. **Admin › Tenants › Novo:** nome, pacote, e-mail do dono, e, se for o caso, *Piloto* e *Mensalidade acordada*.
2. O cliente liga o **seu** WhatsApp no onboarding.
3. **A chave de IA é dele:** obtenha-a no provedor (uma por cliente) e registe-a em *IA › Credenciais* **dentro do cliente**, ou
   deixe o dono do cliente fazê-lo. Ele gere-a sozinho depois.
4. **Admin › Tenants › (cliente) › Agente-modelo:** escolha a organização dos modelos e o agente. A cópia nasce em
   **rascunho**, com o WhatsApp do cliente, e liga-se à chave do cliente se ela já estiver validada.
5. Termine o que a lista "falta configurar" diz (funis, conhecimento, follow-ups), teste e publique **dentro do cliente**.

## Parte C — Ligar a cobrança (uma vez)

1. Dentro da organização **Songhai**: *Pagamentos (PaySuite)* (a conta que recebe).
2. **Admin › Faturação → Quem recebe:** escolha a organização Songhai e carregue em **Ligar faturação**.
3. Preencha, na mesma tela: os **tokens** de cada pacote (*O que cada pacote inclui*), os **dados de pagamento directo**
   (banco, titular, NIB, números M-Pesa e e-Mola), os **e-mails que recebem os seus avisos** e o **preço dos extras**.

---

## Se algo correr mal

| Sintoma | Causa mais provável | O que fazer |
|---|---|---|
| **Publicar** recusa (`credential_missing`) | O agente não tem credencial validada | Passo 2; escolha-a no Passo 8 |
| **Publicar** recusa por número | O número não está *WORKING* | Passo 1 |
| O Idris não responde a ninguém | Número em modo de teste (lista autorizada) | Libertar na Central de avisos |
| Inventa um preço ou diz "não sei" | Conhecimento não está «pronto» | Passo 5 (chave da OpenAI) |
| Não consegue marcar | Google desligado, tipo sem responsável, ou skill por instalar | Passo 7 inteiro |
| O follow-up nunca dispara | Fluxo em rascunho, ou não ligado ao agente | Passo 6 (os dois passos) |
| O aviso de teste não chega | Canal parado, ou número igual ao do remetente | Passo 1; use outro número de destino |
| O e-mail de aviso não sai | Sem SMTP/Resend, ou endereço público não configurado | Admin › E-mail |
| Respostas longas e "robóticas" | Prompt alterado, ou "dividir mensagens" desligado | Reponha o prompt da secção 3; ligue-o no Passo 8 |
| Quer mudar o prompt depois de publicado | Versão publicada é imutável | Edite → nova versão em rascunho → teste → publique |

## Lista final (antes de dar o número a clientes)

- [ ] Número *WORKING*; chaves da Anthropic e da OpenAI **validadas**
- [ ] Conhecimento **pronto**; funil com uma etapa *ganhou* e uma *perdeu*
- [ ] Dois follow-ups **publicados** e ligados ao agente
- [ ] Agenda do gerente conectada; tipo «Conversa com o gerente» com responsável
- [ ] Aviso de teste chegou ao telemóvel do gerente
- [ ] As 10 mensagens do Passo 10 responderam como esperado
- [ ] **Publicado** por si, e confirmado com uma mensagem real de outro telemóvel
- [ ] Memória publicada
