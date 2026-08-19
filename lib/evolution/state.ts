/**
 * Tradutor único do vocabulário CRU da Evolution API (`"open" | "connecting" |
 * "close"`, medido em `EvolutionClient.getConnectionState`) para o vocabulário
 * CANÔNICO de `channel_sessions.status` (`channel_sessions_status_check`:
 * `STARTING | SCAN_QR_CODE | WORKING | STOPPED | FAILED`).
 *
 * ─── Por que isto precisa ser UMA função, chamada dos DOIS lados ───────────
 *
 * Dois caminhos escrevem `channel_sessions.status` a partir do estado da
 * Evolution: `evolutionAdapter.checkHealth` (varredura) e `evolutionInbound`
 * (webhook `connection.update`, empurrão). Os dois liam `state` cru e
 * devolviam ele direto — e o CHECK da coluna só aceita os cinco valores
 * acima. O valor cru não bate em nenhum deles, o UPDATE falha, e quem chama
 * (`sincronizarSaudeDaConexao`/rotas) não checa o erro: a sessão fica
 * PARA SEMPRE em `STARTING`, o QR nunca aparece (a tela só mostra a imagem em
 * `SCAN_QR_CODE`), o envio nunca destrava (exige `WORKING`), e um `"close"`
 * (desconectado) é lido como saudável — resolvendo um aviso que devia estar
 * abrindo. Ter a tradução em dois lugares divergiria com o tempo; ter em um
 * só é o que garante que os dois caminhos nunca discordem.
 *
 * ─── Por que estado desconhecido vira FAILED, e não passa direto ───────────
 *
 * Um estado que este client não reconhece (API nova, campo renomeado) NÃO
 * pode virar silenciosamente um dos estados "está tudo bem" — isso é
 * exatamente o defeito que este arquivo existe para fechar. `FAILED` é o
 * único que diz "algo está errado" sem inventar um motivo.
 */
export type CanonicalChannelStatus = "STARTING" | "SCAN_QR_CODE" | "WORKING" | "STOPPED" | "FAILED";

export function mapEvolutionState(state: string): CanonicalChannelStatus {
  switch (state) {
    case "open":
      return "WORKING";
    case "connecting":
      return "SCAN_QR_CODE";
    case "close":
      return "STOPPED";
    default:
      return "FAILED";
  }
}
