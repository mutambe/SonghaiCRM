"use server";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { env } from "@/lib/env";
import { requestRenewal } from "@/lib/licensing/central-client";

export async function renovarLicenca(): Promise<{ checkoutUrl: string } | { error: string }> {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org || ROLE_RANK[org.role] < ROLE_RANK.admin) {
    return { error: "Permissão insuficiente." };
  }

  if (!env.LICENSE_KEY || !env.LICENSING_CENTRAL_URL) {
    return { error: "Esta instalação não tem licenciamento configurado." };
  }

  try {
    const { checkoutUrl } = await requestRenewal(env.LICENSING_CENTRAL_URL, env.LICENSE_KEY);
    return { checkoutUrl };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Falha ao gerar cobrança." };
  }
}
