/**
 * Convite (ou resolução) do usuário que vai virar owner/admin de um tenant.
 *
 * Extraído de app/api/v1/admin/tenants/route.ts (POST) para ser reaproveitado
 * por app/api/v1/admin/tenants/[id]/owner/route.ts (trocar e-mail do
 * responsável depois que o tenant já existe) — mesma regra do GoTrue nos dois
 * lugares: convite recusado por já existir ("email_exists") não é falha, é
 * "some ao invés de convidar", então resolve o user_id existente.
 */
import { type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

// Esta versão de @supabase/auth-js (GoTrueAdminApi.listUsers) não aceita
// filtro por e-mail no server — só pagina o diretório inteiro (mesma
// limitação documentada em app/api/v1/admin/users/route.ts). Varre com teto:
// uma página vazia OU o teto (o diretório pode ser grande) encerra a busca
// sem achar.
const RESOLVE_MAX_PAGES = 50;
const RESOLVE_PER_PAGE = 1000;

export async function resolveUserIdByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<string | null> {
  const alvo = email.toLowerCase();
  for (let page = 1; page <= RESOLVE_MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: RESOLVE_PER_PAGE,
    });
    if (error || !data?.users?.length) return null;
    const found = data.users.find((u) => u.email?.toLowerCase() === alvo);
    if (found) return found.id;
    if (data.users.length < RESOLVE_PER_PAGE) return null; // última página
  }
  return null;
}

export interface InviteOwnerResult {
  ok: true;
  userId: string;
  /** false quando o e-mail já era de uma conta confirmada (achado, não convidado). */
  wasInvited: boolean;
}

export interface InviteOwnerFailure {
  ok: false;
  message: string;
}

/**
 * Convida `email` como owner. Se o GoTrue recusar por já existir
 * (`email_exists`), resolve o user_id existente ao invés de falhar — mesmo
 * tratamento dos dois pontos de entrada que convidam owner.
 */
export async function inviteOrResolveOwner(
  admin: SupabaseClient,
  email: string,
): Promise<InviteOwnerResult | InviteOwnerFailure> {
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    email,
    { redirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/confirm?type=invite` },
  );

  if (invited?.user) {
    return { ok: true, userId: invited.user.id, wasInvited: true };
  }

  const emailJaExiste =
    inviteError?.code === "email_exists" || inviteError?.status === 422;
  const existingUserId = emailJaExiste ? await resolveUserIdByEmail(admin, email) : null;

  if (!existingUserId) {
    return { ok: false, message: inviteError?.message ?? "Falha ao convidar" };
  }
  return { ok: true, userId: existingUserId, wasInvited: false };
}
