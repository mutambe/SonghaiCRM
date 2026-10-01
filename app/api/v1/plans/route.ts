/**
 * GET /api/v1/plans — o catálogo público de pacotes do SonghaiCRM (migration
 * 0504), para a página de preços. Só o que está à venda e só o que um visitante
 * pode ver: nome, preço, taxa de instalação, moeda e limites. Sem sessão; com
 * teto de 60 pedidos por minuto por IP.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip")?.trim();
  if (ip) {
    const r = await checkRateLimit(`plans:list:${ip}`, 60, 60);
    if (!r.allowed) {
      return fail("rate_limited", "Muitas requisições. Tente de novo dentro de um minuto.", 429, {
        requestId,
        headers: { "Retry-After": "60" },
      });
    }
  }

  const { data, error } = await createAdminClient()
    .from("plans")
    .select("slug, display_name, price_cents, setup_fee_cents, currency, limits")
    .eq("is_active", true)
    .order("price_cents", { ascending: true, nullsFirst: false });
  if (error) return fail("internal_error", "Falha ao listar os pacotes.", 500, { requestId });

  return ok(data ?? [], { requestId });
}
