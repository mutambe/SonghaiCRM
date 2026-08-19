/**
 * Proxy do QR de conexão — o único lugar que sabe QUAL provider mostra QR e
 * como buscar a imagem dele. Existe para a rota `channel-sessions/[id]/qr`
 * não precisar perguntar "qual canal é" (invariante 1 da doutrina).
 */
import { getEvolutionClient } from "@/lib/evolution/client";
import { getWahaClient } from "@/lib/waha/client";

export type QrImageResult =
  | { ok: true; contentType: string; body: ArrayBuffer }
  | { ok: false; status: number; channelState?: string };

export interface QrSessionInput {
  provider: string;
  waha_session_name: string | null;
  evolution_instance_name: string | null;
}

export async function fetchQrImage(session: QrSessionInput): Promise<QrImageResult> {
  if (session.provider === "waha") {
    if (!session.waha_session_name) return { ok: false, status: 409, channelState: "no-session" };
    const baseUrl = process.env.WAHA_API_BASE_URL;
    const apiKey = process.env.WAHA_API_KEY;
    if (!baseUrl || !apiKey || apiKey === "dev_plaintext_change_me") return { ok: false, status: 503 };
    const upstream = await fetch(
      `${baseUrl}/api/${encodeURIComponent(session.waha_session_name)}/auth/qr?format=image`,
      { headers: { "X-Api-Key": apiKey }, cache: "no-store" },
    );
    if (!upstream.ok) return { ok: false, status: upstream.status };
    return {
      ok: true,
      contentType: upstream.headers.get("content-type") ?? "image/png",
      body: await upstream.arrayBuffer(),
    };
  }

  if (session.provider === "evolution") {
    if (!session.evolution_instance_name) return { ok: false, status: 409 };
    const client = getEvolutionClient();
    if (!client) return { ok: false, status: 503 };
    const { base64 } = await client.getQr(session.evolution_instance_name);
    if (!base64) return { ok: false, status: 404 };
    // `base64` é uma data URL (`data:image/png;base64,AAAA...`) — decodifica
    // para o mesmo formato binário que o caminho do WAHA devolve, para a rota
    // não precisar saber a diferença.
    const [prefix, dados] = base64.split(",");
    const contentType = prefix?.match(/data:(.*);base64/)?.[1] ?? "image/png";
    const binario = Buffer.from(dados ?? "", "base64");
    return { ok: true, contentType, body: binario.buffer.slice(binario.byteOffset, binario.byteOffset + binario.byteLength) };
  }

  // Provider sem QR (meta_cloud, zernio — conectam por credencial, não por
  // pareamento). Ver a instância de `getWahaClient` acima: só existe para
  // deixar o import usado sem quebrar tree-shaking em builds estritos.
  void getWahaClient;
  return { ok: false, status: 409, channelState: "no-session" };
}
