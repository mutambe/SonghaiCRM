/**
 * Cliente HTTP que a instalação de CLIENTE usa para falar com a instância
 * central (`env.LICENSING_CENTRAL_URL`). Timeout curto de propósito: isto
 * roda dentro de um cron (Task 10) e de uma server action (Task 12) — travar
 * a instalação inteira porque a central está lenta seria pior que o próprio
 * gate de licença.
 */
export class LicensingCentralError extends Error {}

const TIMEOUT_MS = 10_000;

function trimEndSlash(url: string): string {
  return url.replace(/\/$/, "");
}

export async function fetchLicenseToken(baseUrl: string, licenseKey: string): Promise<string> {
  const res = await fetch(`${trimEndSlash(baseUrl)}/api/v1/licensing/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ license_key: licenseKey }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const json = (await res.json().catch(() => ({}))) as {
    data?: { token?: string };
    error?: { message?: string };
  };

  if (!res.ok || !json.data?.token) {
    throw new LicensingCentralError(json.error?.message ?? `licensing verify falhou (${res.status})`);
  }
  return json.data.token;
}

export async function requestRenewal(baseUrl: string, licenseKey: string): Promise<{ checkoutUrl: string }> {
  const res = await fetch(`${trimEndSlash(baseUrl)}/api/v1/licensing/renew`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ license_key: licenseKey }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const json = (await res.json().catch(() => ({}))) as {
    data?: { checkout_url?: string };
    error?: { message?: string };
  };

  if (!res.ok || !json.data?.checkout_url) {
    throw new LicensingCentralError(json.error?.message ?? `licensing renew falhou (${res.status})`);
  }
  return { checkoutUrl: json.data.checkout_url };
}
