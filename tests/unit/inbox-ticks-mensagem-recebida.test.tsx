import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MessageBubble } from "@/components/inbox/MessageBubble";
import type { Message } from "@/lib/types/messaging";

/**
 * TICKS DA MENSAGEM RECEBIDA (inbound).
 *
 * O relato: mensagem do cliente pro agente não mostrava os 2 tracinhos, nem a
 * cor mudava depois que o agente lia. Causa: `AckIndicator` só renderizava
 * pra `isOutbound` — inbound nunca tinha indicador nenhum, `read_at` nunca
 * era escrito pra essa direção.
 */
function msg(over: Partial<Message>): Message {
  return {
    id: "m1",
    conversation_id: "c1",
    organization_id: "org1",
    contact_id: "ct1",
    channel_session_id: "s1",
    external_id: "x1",
    type: "text",
    direction: "inbound",
    status: "delivered",
    ack: null,
    body: "oi",
    media_url: null,
    media_mime: null,
    media_size_bytes: null,
    media_storage_path: null,
    sent_via: "external_device",
    sent_by_user_id: null,
    sent_at: "2026-07-21T20:00:00.000Z",
    delivered_at: "2026-07-21T20:00:00.000Z",
    read_at: null,
    edited_at: null,
    revoked_at: null,
    error_code: null,
    error_message: null,
    metadata: {},
    created_at: "2026-07-21T20:00:00.000Z",
    ...over,
  } as Message;
}

describe("ticks de mensagem inbound", () => {
  it("sem read_at: mostra os 2 ticks em cinza (recebida, ainda não lida pelo agente)", () => {
    render(<MessageBubble message={msg({ read_at: null })} />);
    const tick = screen.getByLabelText("Recebida");
    expect(tick.getAttribute("class")).not.toMatch(/text-green-500/);
  });

  it("com read_at: os 2 ticks ficam verdes (lida pelo agente)", () => {
    render(<MessageBubble message={msg({ read_at: "2026-07-21T20:05:00.000Z" })} />);
    const tick = screen.getByLabelText("Lida");
    expect(tick.getAttribute("class")).toMatch(/text-green-500/);
  });

  it("outbound continua com o indicador antigo (azul), não o verde de inbound", () => {
    render(
      <MessageBubble
        message={msg({ direction: "outbound", status: "read", read_at: "2026-07-21T20:05:00.000Z" })}
      />,
    );
    const tick = screen.getByLabelText("Lida");
    expect(tick.getAttribute("class")).toMatch(/text-blue-400/);
  });
});
