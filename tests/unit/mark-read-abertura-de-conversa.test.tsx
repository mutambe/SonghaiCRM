import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O elo do meio entre "agente abriu a conversa" e a rota de mark-read: o
 * hook precisa disparar o POST quando `conversationId` muda — sem isso a
 * rota existe e nunca é chamada, e os ticks inbound nunca saem do cinza.
 */
const postSpy = vi.fn(async (_url: string, _body: unknown) => ({ data: { marked_count: 0 } }));
vi.mock("@/lib/api/client", () => ({ apiClient: { post: (u: string, b: unknown) => postSpy(u, b) } }));

import { useMarkConversationRead } from "@/hooks/inbox/useMarkConversationRead";

function Harness({ conversationId }: { conversationId: string | null }) {
  useMarkConversationRead(conversationId);
  return null;
}

function wrapper(conversationId: string | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Harness conversationId={conversationId} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  postSpy.mockClear();
});

describe("useMarkConversationRead", () => {
  it("abrir uma conversa dispara POST /mark-read para ela", async () => {
    wrapper("conv-1");
    await waitFor(() => expect(postSpy).toHaveBeenCalledWith("/api/v1/conversations/conv-1/mark-read", {}));
  });

  it("sem conversa selecionada, não dispara nada", async () => {
    wrapper(null);
    await new Promise((r) => setTimeout(r, 10));
    expect(postSpy).not.toHaveBeenCalled();
  });
});
