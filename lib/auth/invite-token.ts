/**
 * Stateless HMAC-SHA256 invite token. Self-contained payload, signed and
 * base64url-encoded — no DB row required to issue. Verified at accept time.
 *
 * Format: `<body>.<sig>` where
 *   - body = base64url(JSON({invite_id, email, organization_id, role, exp}))
 *   - sig  = base64url(HMAC_SHA256(secret, body))
 *
 * Secret resolution: INVITE_TOKEN_SECRET → INTERNAL_SECRET → NENHUM.
 * Verification uses `timingSafeEqual` to avoid timing oracles.
 *
 * ⚠️ SonghaiCRM — SEM SEGREDO, FALHA FECHADO. A cadeia do upstream termina no
 * literal "dev-fallback", e o repo é público: sem segredo configurado, qualquer
 * um forja um convite com `organization_id` e `role` à escolha — admin em
 * qualquer organização, porque o aceite confia só na assinatura. E `??` não
 * pega string VAZIA: `INVITE_TOKEN_SECRET=` no `.env` assinava com chave vazia.
 * Aqui vazio conta como ausente, emitir sem segredo lança e verificar sem
 * segredo recusa (sem 500 na página de aceite).
 */
import { z } from "zod";
import { interfaceSettingsSchema, type InterfaceSettings } from "@/lib/navigation/interface";
import { createHmac, timingSafeEqual } from "node:crypto";

function segredo(): string | null {
  return process.env.INVITE_TOKEN_SECRET || process.env.INTERNAL_SECRET || null;
}

const SECRET = (): string => {
  const s = segredo();
  if (!s) {
    throw new Error("invite_secret_missing: defina INTERNAL_SECRET (ou INVITE_TOKEN_SECRET) para emitir convites");
  }
  return s;
};

export interface InvitePayload {
  interface_settings?: InterfaceSettings;
  invite_id: string;
  email: string;
  organization_id: string;
  role: string;
  exp: number; // epoch seconds
  iat?: number;
  invited_by?: string;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function signInviteToken(payload: InvitePayload): string {
  const json = JSON.stringify(payload);
  const body = b64url(Buffer.from(json, "utf8"));
  const sig = b64url(createHmac("sha256", SECRET()).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyInviteToken(token: string): InvitePayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  // Verificar não lança: a página de aceite trataria o throw como 500. Sem
  // segredo não há assinatura que se possa conferir — o convite é inválido.
  const s = segredo();
  if (!s) return null;
  const expected = b64url(createHmac("sha256", s).update(body).digest());
  if (sig.length !== expected.length) return null;

  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }

  let payload: InvitePayload;
  try {
    const json = Buffer.from(body, "base64url").toString("utf8");
    payload = JSON.parse(json) as InvitePayload;
  } catch {
    return null;
  }

  const checked = z
    .object({
      invite_id: z.string().uuid(),
      email: z.string().email(),
      organization_id: z.string().uuid(),
      role: z.enum(["viewer", "agent", "manager", "admin"]),
      exp: z.number().int().positive(),
      iat: z.number().int().positive().optional(),
      invited_by: z.string().uuid().optional(),
      interface_settings: interfaceSettingsSchema.optional(),
    })
    .safeParse(payload);
  if (!checked.success) return null;
  payload = checked.data;

  if (payload.exp * 1000 < Date.now()) return null;
  return payload;
}

export const INVITE_TTL_SECONDS = 60 * 60 * 24; // 24h
