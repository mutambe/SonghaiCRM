import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "As duas coisas" (decisão do usuário): abrir a conversa marca como lida, e
 * responder também — cobre o caso de uma mensagem inbound ter chegado
 * DEPOIS que o mark-read de abertura já rodou.
 */
const postSpy = vi.fn(async (url: string, _body: unknown) => {
  if (url === "/api/v1/messages") return { data: { id: "m1" } };
  return { data: { marked_count: 0 } };
});
vi.mock("@/lib/api/client", () => ({ apiClient: { post: (u: string, b: unknown) => postSpy(u, b) } }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));

import { useSendMessage } from "@/hooks/inbox/useSendMessage";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  postSpy.mockClear();
});

describe("useSendMessage marca a conversa como lida ao responder", () => {
  it("envio bem-sucedido também chama mark-read da mesma conversa", async () => {
    const { result } = renderHook(() => useSendMessage(), { wrapper });
    result.current.mutate({ conversation_id: "conv-9", body: "oi" });

    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith("/api/v1/conversations/conv-9/mark-read", {}),
    );
  });
});
