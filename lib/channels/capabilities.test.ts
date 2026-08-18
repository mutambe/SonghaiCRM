import { describe, expect, it } from "vitest";

import {
  CHANNEL_CAPABILITIES,
  CHANNEL_LABELS,
  CHANNEL_PROVIDER_EVOLUTION,
  capabilitiesOf,
} from "./capabilities";

describe("capabilities do Evolution API", () => {
  it("tem o mesmo perfil de auto-restrição do WAHA (QR, sem WABA)", () => {
    const caps = capabilitiesOf(CHANNEL_PROVIDER_EVOLUTION);
    expect(caps.freeformOutsideWindow).toBe(true);
    expect(caps.requiresTemplates).toBe(false);
    expect(caps.canManageTemplates).toBe(false);
    expect(caps.banRisk).toBe(true);
    expect(caps.groups).toBe("full");
    expect(caps.costPerMessage).toBe(false);
  });

  it("está na matriz para todo ChannelProvider", () => {
    expect(Object.keys(CHANNEL_CAPABILITIES).sort()).toEqual(
      ["evolution", "meta_cloud", "waha", "zernio"].sort(),
    );
  });
});

describe("CHANNEL_LABELS", () => {
  it("tem rótulo para todo ChannelProvider, mesma chave da matriz de capabilities", () => {
    expect(Object.keys(CHANNEL_LABELS).sort()).toEqual(
      ["evolution", "meta_cloud", "waha", "zernio"].sort(),
    );
  });

  it("nomeia o Evolution API pelo nome comercial", () => {
    expect(CHANNEL_LABELS.evolution).toBe("Evolution API");
  });
});
