/**
 * Adapter Evolution API — mirror de `lib/channels/adapters/waha.ts`: burro de
 * propósito, delega tudo a `lib/evolution/*`. Nenhuma regra de negócio aqui
 * (ver `ChannelAdapter` em ../types).
 */
import { getEvolutionClient } from "@/lib/evolution/client";
import { parseEvolutionMessageId } from "@/lib/evolution/message-id";
import { resolveEvolutionChatId } from "@/lib/evolution/send";
import { mapEvolutionState } from "@/lib/evolution/state";
import type { ChannelAdapter, ChannelHealth, OutboundEnvelope, RecipientInput } from "../types";

export const evolutionAdapter: ChannelAdapter = {
  provider: "evolution",

  resolveRecipient(input: RecipientInput): string | null {
    return resolveEvolutionChatId({
      isGroup: input.isGroup,
      groupChatId: input.groupChatId,
      phoneNumber: input.phoneNumber,
    });
  },

  isConfigured(): boolean {
    return getEvolutionClient() !== null;
  },

  codes: {
    notConfigured: "evolution_not_configured",
    sendFailed: "evolution_error",
    unknownError: "evolution_unknown",
  },

  async checkHealth(input: { sessionRef: string }): Promise<ChannelHealth> {
    const client = getEvolutionClient();
    if (!client) return { reachable: false, status: null, detail: "transporte_nao_configurado" };
    try {
      const state = await client.getConnectionState(input.sessionRef);
      // `state === null` é "não deu para perguntar" (upstream não respondeu
      // ok) — mesma semântica documentada em `ChannelHealth.status`: não pode
      // ser tratado como saudável, e `reachable: false` é o que impede
      // `sincronizarSaudeDaConexao` de fechar um aviso aberto sem saber do que
      // está falando.
      if (state === null) return { reachable: false, status: null, detail: "estado_indisponivel" };
      // NUNCA repassa `state` cru: é o vocabulário da Evolution
      // (`open`/`connecting`/`close`), e `channel_sessions.status` só aceita
      // os 5 valores do CHECK. Ver `mapEvolutionState` — mesma tradução usada
      // pelo webhook `connection.update`, para os dois caminhos nunca
      // divergirem.
      return { reachable: true, status: mapEvolutionState(state), detail: null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "erro_desconhecido";
      return { reachable: false, status: null, detail: msg.slice(0, 200) };
    }
  },

  async send(envelope: OutboundEnvelope): Promise<{ externalId: string | null }> {
    const client = getEvolutionClient();
    // Sem env configurado o comportamento é NOOP, não erro — mesma regra do
    // adapter WAHA: a UI mostra o banner de canal não configurado.
    if (!client) return { externalId: null };

    if (envelope.media) {
      const mediatype = mediatypeDoEnvelope(envelope.kind);
      const res = await client.sendMedia(envelope.sessionRef, envelope.to, {
        mediatype,
        media: envelope.media.url,
        caption: envelope.media.caption ?? envelope.body ?? undefined,
        fileName: envelope.media.filename ?? undefined,
      });
      return { externalId: parseEvolutionMessageId(res) };
    }

    const res = await client.sendText(envelope.sessionRef, envelope.to, envelope.body ?? "");
    return { externalId: parseEvolutionMessageId(res) };
  },
};

function mediatypeDoEnvelope(kind: string): "image" | "video" | "document" | "audio" {
  switch (kind) {
    case "image":
      return "image";
    case "video":
      return "video";
    case "audio":
    case "voice":
      return "audio";
    default:
      return "document";
  }
}
