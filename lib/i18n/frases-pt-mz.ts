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
  "Sua reunião está marcada para": "A sua reunião está marcada para",
  "Seu compromisso está marcado para": "O seu compromisso está marcado para",
  "O horário da sua reunião mudou. Agora é": "O horário da sua reunião foi alterado. Passa a ser",
  "O horário do seu compromisso mudou. Agora é": "O horário do seu compromisso foi alterado. Passa a ser",
  "Passando pra lembrar do seu compromisso:": "Só para lembrar o seu compromisso:",
  "Oi {{nome}}! Passando pra lembrar: {{titulo}}, {{dia}} às {{hora}}.":
    "Olá {{nome}}! Só para lembrar: {{titulo}}, {{dia}} às {{hora}}.",

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
  return Object.prototype.hasOwnProperty.call(FRASES_PT_MZ, texto) ? FRASES_PT_MZ[texto] : undefined;
}
