/**
 * Chamadas de Auth que precisam do client PÚBLICO (anon key), não do admin
 * (service role). `auth.resetPasswordForEmail` só dispara o e-mail de
 * recovery via esta porta — o `admin.auth.admin.*` (GoTrueAdminApi) não tem
 * equivalente que envie o e-mail (generateLink só devolve o link, não entrega).
 *
 * Uso: ações de plataforma onde um admin aciona um reset EM NOME de outro
 * usuário (ex.: "resetar acesso do owner" em app/api/v1/admin/tenants/[id]/owner).
 */
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

export async function sendPasswordRecoveryEmail(email: string, redirectTo: string) {
  const client = createSupabaseClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } },
  );
  return client.auth.resetPasswordForEmail(email, { redirectTo });
}
