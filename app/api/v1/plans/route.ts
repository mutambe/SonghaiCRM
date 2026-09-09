import { randomUUID } from "node:crypto";
import { ok, fail } from "@/lib/api/wrappers";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
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
