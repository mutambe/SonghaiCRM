/**
 * Leitura PURA do payload de webhook da Evolution API — decide, não escreve.
 * Mirror de `lib/channels/zernio/webhook.ts`: quem grava é `lib/evolution/ingest.ts`.
 */

export type EvolutionAttachmentType = "image" | "video" | "audio" | "document" | "sticker" | null;

export interface EvolutionInboundMessage {
  externalId: string;
  chatId: string;
  direction: "inbound" | "outbound";
  body: string | null;
  pushName: string | null;
  attachmentType: EvolutionAttachmentType;
  sentAt: string | null;
}

interface RawEnvelope {
  event?: unknown;
  instance?: unknown;
  data?: unknown;
}

const MEDIA_KEYS: Record<string, Exclude<EvolutionAttachmentType, null>> = {
  imageMessage: "image",
  videoMessage: "video",
  audioMessage: "audio",
  documentMessage: "document",
  stickerMessage: "sticker",
};

export function parseEvolutionInbound(payload: unknown): EvolutionInboundMessage | null {
  if (typeof payload !== "object" || payload === null) return null;
  const env = payload as RawEnvelope;
  if (env.event !== "messages.upsert") return null;
  if (typeof env.data !== "object" || env.data === null) return null;

  const data = env.data as {
    key?: { remoteJid?: unknown; fromMe?: unknown; id?: unknown };
    pushName?: unknown;
    message?: Record<string, unknown>;
    messageTimestamp?: unknown;
  };

  const externalId = data.key?.id;
  const chatId = data.key?.remoteJid;
  if (typeof externalId !== "string" || typeof chatId !== "string") return null;

  const message = data.message ?? {};
  let attachmentType: EvolutionAttachmentType = null;
  let body: string | null = typeof message.conversation === "string" ? message.conversation : null;

  for (const [key, tipo] of Object.entries(MEDIA_KEYS)) {
    const bloco = message[key];
    if (typeof bloco === "object" && bloco !== null) {
      attachmentType = tipo;
      const caption = (bloco as { caption?: unknown }).caption;
      if (typeof caption === "string") body = caption;
      break;
    }
  }

  const timestamp = data.messageTimestamp;
  const sentAt =
    typeof timestamp === "number"
      ? new Date(timestamp * 1000).toISOString()
      : typeof timestamp === "string" && /^\d+$/.test(timestamp)
        ? new Date(Number(timestamp) * 1000).toISOString()
        : null;

  return {
    externalId,
    chatId,
    direction: data.key?.fromMe === true ? "outbound" : "inbound",
    body,
    pushName: typeof data.pushName === "string" ? data.pushName : null,
    attachmentType,
    sentAt,
  };
}

export function parseEvolutionConnectionUpdate(payload: unknown): { state: string } | null {
  if (typeof payload !== "object" || payload === null) return null;
  const env = payload as RawEnvelope;
  if (env.event !== "connection.update") return null;
  if (typeof env.data !== "object" || env.data === null) return null;
  const state = (env.data as { state?: unknown }).state;
  return typeof state === "string" ? { state } : null;
}
