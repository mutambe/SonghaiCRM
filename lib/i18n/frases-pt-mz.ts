/**
 * FRASES EM PORTUGUÊS DE MOÇAMBIQUE — o que a camada de vocabulário não acerta.
 *
 * SonghaiCRM. A camada `./pt-mz.ts` troca PALAVRA (celular→telemóvel,
 * equipe→equipa) e serve para as telas. Ela não reescreve CONSTRUÇÃO: "me diz",
 * "Passando de novo por aqui", "Sua reunião" continuam a soar brasileiros. Isso
 * importa pouco num botão e muito numa mensagem que o CLIENTE da empresa recebe
 * no WhatsApp — é a voz da empresa dele, não a nossa.
 *
 * Por isso este registro: a frase-fonte do upstream (chave, byte a byte) → a
 * frase escrita em português de Moçambique. Vale para as mensagens que saem
 * para o cliente sem passar pelo modelo de IA:
 *   - os modelos de follow-up (`lib/followup/modelos/`), via `escada.ts`;
 *   - os textos da agenda (`lib/agenda/texto-do-compromisso.ts`, lembrete do
 *     cron `agenda-reminder`), via `traduzir()`.
 *
 * Arquivo da distribuição, fora do `dicionario.ts` do upstream, para o merge não
 * colidir. Se o upstream mudar uma frase-fonte, a chave daqui deixa de casar e a
 * frase cai na camada de vocabulário (degrada, não quebra) — e o teste
 * `tests/unit/frases-pt-mz-casam-com-a-fonte.test.ts` reprova a chave órfã.
 */

export const FRASES_PT_MZ: Readonly<Record<string, string>> = {
  // ---- Agenda (texto-do-compromisso.ts e cron agenda-reminder) ----
  // O tipo `cpf` do roteiro é o documento do titular, que aqui é o NUIT
  // (lib/followup/captura-do-fluxo.ts, `capturarCpf`).
  "CPF (confere o dígito)": "NUIT (9 dígitos)",
  // Janela de cortesia do SonghaiCRM (lib/agent-engine/pacing/defaults.ts).
  "Janela operacional 7h-22h": "Janela operacional 6h-23h",
  "Sua reunião está marcada para": "A sua reunião está marcada para",
  "Seu compromisso está marcado para": "O seu compromisso está marcado para",
  "O horário da sua reunião mudou. Agora é": "O horário da sua reunião foi alterado. Passa a ser",
  "O horário do seu compromisso mudou. Agora é": "O horário do seu compromisso foi alterado. Passa a ser",
  "Passando pra lembrar do seu compromisso:": "Só para lembrar o seu compromisso:",
  "Oi {{nome}}! Passando pra lembrar: {{titulo}}, {{dia}} às {{hora}}.":
    "Olá {{nome}}! Só para lembrar: {{titulo}}, {{dia}} às {{hora}}.",

  // ---- Admin › Administradores da plataforma ----
  // A fonte mistura inglês ("Platform Admins", "read-only", "por design") e cita
  // a spec interna; quem lê é o dono da instalação, não quem escreveu a spec.
  "Platform Admins": "Administradores da plataforma",
  "Gerenciamento de Platform Admins é restrito ao DBA":
    "Os administradores da plataforma só se alteram na base de dados",
  "Conforme Spec 01 §3.4 T-04: adição, remoção ou alteração de":
    "Por segurança, acrescentar, retirar ou alterar um registo em",
  "é feita exclusivamente via SQL pelo DBA, com nota explicativa em":
    "faz-se só por SQL, por quem administra o servidor, que deixa uma nota em",
  ". Esta página é informativa e read-only — nenhum botão de modificação está disponível por design.":
    ". Este ecrã serve só para consulta e não tem botões de alteração, de propósito: assim, uma sessão roubada não consegue criar outro administrador.",
  "Nenhum platform admin encontrado": "Nenhum administrador da plataforma encontrado",
  "Platform admins são configurados exclusivamente via DBA.":
    "Os administradores da plataforma são definidos só na base de dados, por quem administra o servidor.",
  "Erro ao carregar platform admins. Tente recarregar.":
    "Não foi possível carregar os administradores da plataforma. Tente recarregar a página.",
  "Status": "Estado",
  // Exemplo de telefone: o de Moçambique (+258), nunca o do Brasil.
  "Use um telefone com DDI por linha, por exemplo +5511999998888.":
    "Use um telefone com indicativo do país por linha, por exemplo +258841234567.",

  // ---- Telas: frases que nenhuma regra da camada acerta ----
  // "a gente" pede o verbo na 1.ª do plural; não é troca de palavra.
  "Ex.: Agradeça o interesse citando o segmento que a pessoa informou, mostre em uma frase como a gente resolve a dificuldade que ela descreveu, e pergunte qual o melhor horário para conversar.":
    "Ex.: Agradeça o interesse referindo o segmento que a pessoa indicou, mostre numa frase como resolvemos a dificuldade que ela descreveu e pergunte qual o melhor horário para conversar.",
  "O que falta a gente resolve nos próximos passos.": "O que falta resolvemos nos próximos passos.",
  "Uma linha basta. É com isso que seu funcionário aprende com quem ele está falando — e que a gente monta o quadro de clientes do seu jeito.":
    "Uma linha basta. É com isso que o seu funcionário aprende com quem está a falar — e que montamos o quadro de clientes à sua maneira.",
  "10 dígitos. Com ou sem hífen — tanto faz, a gente limpa.": "10 dígitos. Com ou sem hífen — tanto faz, nós limpamos.",
  "Sem falar com a gente há (dias)": "Sem falar connosco há (dias)",
  // Pagamento: em Moçambique o exemplo é o M-Pesa, não o Pix.
  "Ex.: Pix": "Ex.: M-Pesa",
  "Ex.: Pagamento em até 3x sem juros no cartão ou 5% de desconto à vista via Pix.":
    "Ex.: Pagamento em até 3 prestações sem juros no cartão ou 5% de desconto a pronto via M-Pesa.",
  // O gasto de IA é em DÓLAR (llm_calls.cost_cents) — o "(R$)" do upstream estava errado também lá.
  "Quanto gastou por dia (R$)": "Quanto gastou por dia (US$)",
  "Custo AI / dia (R$)": "Custo de IA por dia (US$)",
  // "excluir" aqui é deixar de fora, não apagar (a camada troca "excluir" por "eliminar").
  'Para não guardar a origem na aba, adicione data-storage="none" ao script. Para excluir um link, adicione data-rastreio-ignorar nele. Botões controlados apenas por JavaScript e links abreviados precisam de adaptação no site.':
    'Para não guardar a origem no separador, adicione data-storage="none" ao script. Para deixar um link de fora, adicione-lhe data-rastreio-ignorar. Botões controlados apenas por JavaScript e links encurtados precisam de adaptação no site.',

  // ---- Modelos de follow-up da clínica (lib/followup/modelos/clinica.ts) ----
  "Oi! Ficamos de acertar o horário da sua consulta e a conversa parou por aqui. Quer que eu veja o que ainda está livre?":
    "Olá! Tínhamos ficado de acertar o horário da sua consulta e a conversa ficou por aqui. Quer que eu veja o que ainda está livre?",
  "Passando de novo por aqui 🙂 Se ainda quiser marcar, me diz só o melhor período para você — manhã ou tarde — que eu procuro um horário.":
    "Volto a passar por aqui 🙂 Se ainda quiser marcar, diga-me só o período que lhe dá mais jeito — manhã ou tarde — e eu procuro um horário.",
  "Esta é a última vez que eu apareço sobre isso. Se quiser retomar a marcação, é só me responder a qualquer momento. Se preferir deixar para mais para a frente, tudo bem também.":
    "Esta é a última vez que falo sobre isto. Se quiser retomar a marcação, basta responder-me a qualquer momento. Se preferir deixar para mais tarde, também está tudo bem.",
  "Oi! Sobre o exame que foi pedido: quer que eu veja os horários para você? Me responde aqui que eu organizo.":
    "Olá! Sobre o exame que lhe foi pedido: quer que eu veja os horários disponíveis? Responda-me aqui e eu trato disso.",
  "Ainda dá para marcar o seu exame. Me diz o período que funciona melhor — manhã ou tarde — e eu procuro uma data.":
    "Ainda dá para marcar o seu exame. Diga-me o período que lhe dá mais jeito — manhã ou tarde — e eu procuro uma data.",
  "Último lembrete sobre o exame 🙂 Se quiser marcar, me responde que eu vejo uma data. E se você já tiver feito em outro lugar, me avisa que eu encerro por aqui.":
    "Último lembrete sobre o exame 🙂 Se quiser marcar, responda-me e eu vejo uma data. E se já o tiver feito noutro lugar, avise-me e eu encerro por aqui.",
  "Oi! Sei que essa decisão não é simples e não tem pressa nenhuma da nossa parte. Ficou alguma dúvida do que foi conversado na consulta? Pode perguntar por aqui.":
    "Olá! Sei que esta decisão não é simples e não há pressa nenhuma da nossa parte. Ficou com alguma dúvida sobre o que foi conversado na consulta? Pode perguntar por aqui.",
  "Passando para saber como você está pensando. Se quiser rever as condições, o preparo ou as datas possíveis, me chama que eu explico tudo de novo com calma.":
    "Passo só para saber o que está a pensar. Se quiser rever as condições, a preparação ou as datas possíveis, diga-me e eu explico tudo outra vez, com calma.",
  "Faz um tempo que a gente não conversa sobre o seu caso. Se quiser retomar, me responde aqui que eu vejo uma data com a equipe.":
    "Já há algum tempo que não falamos sobre o seu caso. Se quiser retomar, responda-me aqui e eu vejo uma data com a equipa.",
  "Esta é a minha última mensagem sobre isso — não quero incomodar. Se em algum momento você quiser retomar, é só me escrever: o seu histórico continua com a gente.":
    "Esta é a minha última mensagem sobre isto — não quero incomodar. Se em algum momento quiser retomar, basta escrever-me: o seu histórico continua connosco.",
  "Oi! Vi que a gente não conseguiu se encontrar no horário de hoje. Acontece 🙂 Quer que eu veja outra data para você?":
    "Olá! Vi que não conseguimos encontrar-nos no horário de hoje. Acontece 🙂 Quer que eu veja outra data?",
  "Consigo encaixar você em outro horário. Me diz o dia da semana e o período que funcionam melhor para você.":
    "Consigo arranjar-lhe outro horário. Diga-me o dia da semana e o período que lhe dão mais jeito.",
  "Se ainda quiser remarcar, é só me responder. Depois desta eu paro de lembrar, para não encher a sua caixa de mensagem 🙂":
    "Se ainda quiser remarcar, basta responder-me. Depois desta mensagem deixo de lembrar, para não encher a sua caixa de mensagens 🙂",
};

/** A frase em português de Moçambique, ou `undefined` quando o registro não a tem. */
export function fraseEmPortuguesDeMocambique(texto: string): string | undefined {
  // O mesmo interruptor do e2e de `lib/i18n/pt-mz.ts` (`camadaPtMzDesligada`).
  if (process.env.NEXT_PUBLIC_PT_MZ_TEXTO_ORIGINAL === "1") return undefined;
  return Object.prototype.hasOwnProperty.call(FRASES_PT_MZ, texto) ? FRASES_PT_MZ[texto] : undefined;
}
