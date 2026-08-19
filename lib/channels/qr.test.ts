import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchQrImage } from "./qr";

describe("fetchQrImage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("waha: 503 quando WAHA não está configurado", async () => {
    vi.stubEnv("WAHA_API_BASE_URL", "");
    vi.stubEnv("WAHA_API_KEY", "");
    const r = await fetchQrImage({ provider: "waha", waha_session_name: "org_1", evolution_instance_name: null });
    expect(r).toEqual({ ok: false, status: 503 });
  });

  it("evolution: 503 quando Evolution API não está configurado", async () => {
    vi.stubEnv("EVOLUTION_API_BASE_URL", "");
    vi.stubEnv("EVOLUTION_API_KEY", "");
    const r = await fetchQrImage({ provider: "evolution", waha_session_name: null, evolution_instance_name: "org_1" });
    expect(r).toEqual({ ok: false, status: 503 });
  });

  it("provider desconhecido: 409", async () => {
    const r = await fetchQrImage({ provider: "meta_cloud", waha_session_name: null, evolution_instance_name: null });
    expect(r).toEqual({ ok: false, status: 409, channelState: "no-session" });
  });

  it("waha sem waha_session_name: 409 com channelState no-session", async () => {
    const r = await fetchQrImage({ provider: "waha", waha_session_name: null, evolution_instance_name: null });
    expect(r).toEqual({ ok: false, status: 409, channelState: "no-session" });
  });
});
