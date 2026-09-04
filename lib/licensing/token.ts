/**
 * Token curto assinado (Ed25519) que prova o estado da licença sem precisar
 * de contacto de rede a cada request. Assinado só pela instância central
 * (chave privada em `LICENSING_SIGNING_PRIVATE_KEY`); a instância de cliente
 * só tem a chave pública embutida na imagem — editar a própria base de dados
 * não fabrica um token válido, porque a assinatura não bateria mais.
 */
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

export interface LicenseTokenPayload {
  license_id: string;
  status: "trial" | "active" | "past_due" | "revoked";
  current_period_end: string;
  iat: number;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function signLicenseToken(
  payload: Omit<LicenseTokenPayload, "iat">,
  privateKeyPem: string,
): string {
  const full: LicenseTokenPayload = { ...payload, iat: Date.now() };
  const body = b64url(Buffer.from(JSON.stringify(full), "utf8"));
  const key = createPrivateKey(privateKeyPem);
  const signature = sign(null, Buffer.from(body, "utf8"), key);
  return `${body}.${b64url(signature)}`;
}

export function verifyLicenseToken(token: string, publicKeyPem: string): LicenseTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  try {
    const key = createPublicKey(publicKeyPem);
    const valido = verify(null, Buffer.from(body, "utf8"), key, Buffer.from(sig, "base64url"));
    if (!valido) return null;
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as LicenseTokenPayload;
  } catch {
    return null;
  }
}
