import { describe, expect, it } from "vitest";

import { parseEvolutionMessageId } from "./message-id";

describe("parseEvolutionMessageId", () => {
  it("extrai key.id da resposta de envio", () => {
    expect(
      parseEvolutionMessageId({ key: { id: "3EB0ABC123", remoteJid: "5511999999999@s.whatsapp.net", fromMe: true } }),
    ).toBe("3EB0ABC123");
  });

  it("null quando não há key.id", () => {
    expect(parseEvolutionMessageId({})).toBeNull();
    expect(parseEvolutionMessageId(null)).toBeNull();
    expect(parseEvolutionMessageId("string crua")).toBeNull();
  });
});
