import { describe, expect, it } from "vitest";

import { CHANNEL_STATUSES } from "@/lib/schemas/channels";

import { mapEvolutionState } from "./state";

describe("mapEvolutionState", () => {
  it("'open' vira WORKING", () => {
    expect(mapEvolutionState("open")).toBe("WORKING");
  });

  it("'connecting' vira SCAN_QR_CODE", () => {
    expect(mapEvolutionState("connecting")).toBe("SCAN_QR_CODE");
  });

  it("'close' vira STOPPED", () => {
    expect(mapEvolutionState("close")).toBe("STOPPED");
  });

  it("estado desconhecido vira FAILED, não passa direto", () => {
    expect(mapEvolutionState("qualquer_coisa_nova")).toBe("FAILED");
    expect(mapEvolutionState("")).toBe("FAILED");
  });

  it("todo desfecho é um dos 5 valores aceitos pelo CHECK do banco", () => {
    const entradas = ["open", "connecting", "close", "qualquer_coisa_nova", ""];
    for (const e of entradas) {
      expect(CHANNEL_STATUSES as readonly string[]).toContain(mapEvolutionState(e));
    }
  });
});
