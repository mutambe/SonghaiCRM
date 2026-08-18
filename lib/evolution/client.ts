/**
 * Cliente REST mínimo da Evolution API (instância EXTERNA, não gerenciada por
 * este repo — só URL + API key). Mirror de `lib/waha/client.ts`: mesmo
 * formato de erro (`evolution_<status>: <corpo>`), mesmo padrão de
 * `getEvolutionClient()` devolvendo `null` quando o env não está configurado,
 * para quem chama renderizar "canal não configurado" em vez de quebrar.
 *
 * Contrato assumido da Evolution API v2 (não medido contra a instância real
 * do dono do produto nesta task — ver nota no plano). Se a instância dele
 * responder shape diferente, ajuste aqui; o resto do adapter não muda.
 */
export class EvolutionClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private headers(extra?: Record<string, string>): Record<string, string> {
    return { apikey: this.apiKey, "Content-Type": "application/json", ...extra };
  }

  /**
   * Idempotente: 403/409 (instância já existe) são tratados como sucesso —
   * quem chama quer o efeito (instância pronta), não a transição.
   */
  async createInstance(instanceName: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/instance/create`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        instanceName,
        qrcode: true,
        integration: "WHATSAPP-BAILEYS",
      }),
    });
    if (!res.ok && ![403, 409].includes(res.status)) {
      const body = await res.text().catch(() => "");
      throw new Error(`evolution_${res.status}: ${body.slice(0, 200)}`);
    }
  }

  /** QR atual da instância. `base64` é uma data URL (`data:image/png;base64,...`). */
  async getQr(instanceName: string): Promise<{ base64: string | null; pairingCode: string | null }> {
    const res = await fetch(`${this.baseUrl}/instance/connect/${encodeURIComponent(instanceName)}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`evolution_${res.status}`);
    const body = (await res.json()) as { base64?: string; pairingCode?: string };
    return { base64: body.base64 ?? null, pairingCode: body.pairingCode ?? null };
  }

  /** Estado da conexão: `"open" | "connecting" | "close"`, ou `null` se não deu para ler. */
  async getConnectionState(instanceName: string): Promise<string | null> {
    const res = await fetch(
      `${this.baseUrl}/instance/connectionState/${encodeURIComponent(instanceName)}`,
      { headers: this.headers() },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { instance?: { state?: string } };
    return body.instance?.state ?? null;
  }

  /** Idempotente: 404 (instância desconhecida) conta como sucesso. */
  async deleteInstance(instanceName: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/instance/delete/${encodeURIComponent(instanceName)}`, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!res.ok && res.status !== 404) {
      const body = await res.text().catch(() => "");
      throw new Error(`evolution_${res.status}: ${body.slice(0, 200)}`);
    }
  }

  /** Aponta o webhook da instância para o path token desta sessão. */
  async configureWebhook(instanceName: string, webhookUrl: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/webhook/set/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        webhook: {
          url: webhookUrl,
          enabled: true,
          webhook_by_events: false,
          events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`evolution_${res.status}: ${body.slice(0, 200)}`);
    }
  }

  async sendText(instanceName: string, number: string, text: string): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/message/sendText/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ number, text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`evolution_${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json();
  }

  async sendMedia(
    instanceName: string,
    number: string,
    plan: { mediatype: "image" | "video" | "document" | "audio"; media: string; caption?: string; fileName?: string },
  ): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/message/sendMedia/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ number, ...plan }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`evolution_${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json();
  }
}

/**
 * Devolve um client configurado ou `null`. `null` = canal não configurado
 * (env ausente) — quem chama trata como noop, não como erro.
 */
export function getEvolutionClient(): EvolutionClient | null {
  const url = process.env.EVOLUTION_API_BASE_URL;
  const key = process.env.EVOLUTION_API_KEY;
  if (!url || !key) return null;
  return new EvolutionClient(url, key);
}
