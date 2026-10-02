/**
 * QUE CANAIS SABEM REAGIR A UMA MENSAGEM — SonghaiCRM.
 *
 * A pergunta que a TELA faz antes de mostrar os emojis na bolha, sem ter um
 * adapter na mão (o adapter é código de servidor). É a resposta declarativa de
 * `ChannelAdapter.reactToMessage`, como `alteraMensagemEnviada` é a de
 * `editMessage` — mas num arquivo próprio, fora da matriz de capabilities do
 * upstream, para o `git merge upstream/main` não tropeçar nela.
 *
 * Mora em `lib/channels/` porque é o único lugar onde o nome do provider pode
 * aparecer (`lint:channels`). Canal novo que implemente `reactToMessage` entra
 * aqui — o teste `reacoes-e-leitura-no-whatsapp.test.ts` cobra as duas pontas.
 */
import { transportaMensagem } from "./capabilities";

export const CANAIS_QUE_REAGEM = ["waha"] as const;

export function canalReageAMensagens(provider: string | null | undefined): boolean {
  return transportaMensagem(provider) && (CANAIS_QUE_REAGEM as readonly string[]).includes(provider ?? "");
}
