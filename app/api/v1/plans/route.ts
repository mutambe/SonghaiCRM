import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/wrappers";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limited = await checkRateLimit(`plans:list:${ip}`, 60, 60);
  if (!limited.allowed) {
    return fail("rate_limited", "Muitas requisições. Tente novamente em instantes.", 429, {
      requestId,
    });
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("plans")
    .select("id, slug, display_name, price_cents, setup_fee_cents, currency")
    .eq("is_active", true)
    .order("price_cents", { ascending: true, nullsFirst: false });

  if (error) {
    return fail("internal_error", "Falha ao listar pacotes", 500, {
      requestId,
      details: error.message,
    });
  }

  return ok(data ?? [], { requestId });
}
