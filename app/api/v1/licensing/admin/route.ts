/**
 * POST /api/v1/licensing/admin — emissão manual de licença (Songhai only).
 *
 * Sem self-service nesta versão: a venda acontece fora do sistema, e quem
 * administra a instância central chama isto (via painel interno ou curl) para
 * registar o cliente e gerar a chave que ele cola no `.env` da instalação
 * dele. Ver docs/superpowers/specs/2026-09-04-licenciamento-paysuite-design.md.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { loadAuthUser } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  customer_name: z.string().min(1).max(200),
  contact_email: z.string().email(),
  notes: z.string().max(2000).optional(),
  plan_amount_cents: z.number().int().positive(),
  plan_interval_days: z.number().int().positive().default(30),
  trial_days: z.number().int().min(0).default(7),
});

export async function GET(): Promise<Response> {
  const requestId = randomUUID();

  const user = await loadAuthUser();
  if (!user?.is_platform_admin) {
    return fail("forbidden", "Só platform admin lista licenças.", 403, { requestId });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("licensing_licenses")
    .select(
      "id, license_key, status, plan_amount_cents, plan_interval_days, trial_ends_at, current_period_end, created_at, licensing_installs(customer_name, contact_email)",
    )
    .order("created_at", { ascending: false });

  if (error) {
    return fail("internal_error", error.message, 500, { requestId });
  }

  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const user = await loadAuthUser();
  if (!user?.is_platform_admin) {
    return fail("forbidden", "Só platform admin emite licenças.", 403, { requestId });
  }

  const json = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(json);
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const { customer_name, contact_email, notes, plan_amount_cents, plan_interval_days, trial_days } =
    parsed.data;
  const admin = createAdminClient();

  const { data: install, error: installErr } = await admin
    .from("licensing_installs")
    .insert({ customer_name, contact_email, notes: notes ?? null })
    .select("id")
    .single();
  if (installErr || !install) {
    return fail("internal_error", installErr?.message ?? "falha ao criar install", 500, { requestId });
  }

  const trialEndsAt = new Date(Date.now() + trial_days * 24 * 60 * 60 * 1000).toISOString();
  const licenseKey = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");

  const { data: license, error: licenseErr } = await admin
    .from("licensing_licenses")
    .insert({
      install_id: (install as { id: string }).id,
      license_key: licenseKey,
      status: "trial",
      plan_amount_cents,
      plan_interval_days,
      trial_ends_at: trialEndsAt,
      current_period_end: trialEndsAt,
    })
    .select("id, license_key, current_period_end")
    .single();
  if (licenseErr || !license) {
    return fail("internal_error", licenseErr?.message ?? "falha ao criar licença", 500, { requestId });
  }

  void audit({
    action: "licensing.license_issued",
    actorUserId: user.id,
    organizationId: null,
    resourceType: "licensing_license",
    resourceId: (license as { id: string }).id,
    requestId,
    metadata: { customer_name, plan_amount_cents, plan_interval_days, trial_days },
  });

  return ok(license, { status: 201, requestId });
}
