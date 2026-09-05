/**
 * POST /api/v1/licensing/verify — a instância de cliente chama isto (via
 * cron diário, `lib/licensing/central-client.ts`) para renovar o token
 * cacheado. `status` é sempre DERIVADO na hora a partir de
 * `current_period_end`/`trial_ends_at` — nunca fica um valor "vencido"
 * parado no banco esperando um cron virar; a única escrita no `status` da
 * licença acontece no webhook de pagamento (Task 8) e na revogação manual.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { signLicenseToken } from "@/lib/licensing/token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BodySchema = z.object({ license_key: z.string().min(10) });

interface LicenseRow {
  id: string;
  status: string;
  current_period_end: string;
  trial_ends_at: string | null;
}

export function deriveStatus(license: LicenseRow): "trial" | "active" | "past_due" | "revoked" {
  if (license.status === "revoked") return "revoked";
  if (Date.now() > new Date(license.current_period_end).getTime()) return "past_due";
  return license.status === "trial" ? "trial" : "active";
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", "license_key ausente ou inválido.", 422, { requestId });
  }
  const { license_key: licenseKey } = parsed.data;

  const limited = await checkRateLimit(`licensing:verify:${licenseKey}`, 30, 3600);
  if (!limited.allowed) {
    return fail("rate_limited", "Muitas verificações. Tente novamente mais tarde.", 429, { requestId });
  }

  const admin = createAdminClient();
  const { data: license } = await admin
    .from("licensing_licenses")
    .select("id, status, current_period_end, trial_ends_at")
    .eq("license_key", licenseKey)
    .maybeSingle();

  if (!license) {
    return fail("not_found", "Chave de licença desconhecida.", 404, { requestId });
  }

  const row = license as LicenseRow;
  const status = deriveStatus(row);
  const token = signLicenseToken(
    { license_id: row.id, status, current_period_end: row.current_period_end },
    env.LICENSING_SIGNING_PRIVATE_KEY,
  );

  return ok({ token, status, current_period_end: row.current_period_end }, { requestId });
}
