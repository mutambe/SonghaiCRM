import { describe, expect, it } from "vitest";

import { resolveEvolutionChatId } from "./send";

describe("resolveEvolutionChatId", () => {
  it("grupo: usa o groupChatId direto", () => {
    expect(
      resolveEvolutionChatId({ isGroup: true, groupChatId: "123-456@g.us", phoneNumber: null }),
    ).toBe("123-456@g.us");
  });

  it("individual: telefone vira <digitos>@s.whatsapp.net", () => {
    expect(
      resolveEvolutionChatId({ isGroup: false, groupChatId: null, phoneNumber: "+55 11 99999-9999" }),
    ).toBe("5511999999999@s.whatsapp.net");
  });

  it("sem telefone e sem grupo: null", () => {
    expect(resolveEvolutionChatId({ isGroup: false, groupChatId: null, phoneNumber: null })).toBeNull();
  });
});
