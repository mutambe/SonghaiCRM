/**
 * QUEM RESPONDE POR UMA ORGANIZAÇÃO — SonghaiCRM (porte do `b1b1eb812` do fork
 * sobre o modelo de convite do upstream).
 *
 * Três estados, lidos sem confiar em nada que o cliente mande:
 *
 * - `ativo`: há um `admin` aceite, não revogado e que não é o vínculo
 *   PROVISÓRIO de quem criou a organização (`provisional_until_handover`, que
 *   só existe até o dono assumir). O vínculo do próprio criador conta quando ele
 *   criou a organização para si — aí não é provisório.
 * - `convite_pendente`: ninguém assumiu, mas há convite de `admin` em aberto
 *   em `team_invites` (o mais recente).
 * - `sem_responsavel`: nem uma coisa nem outra — por exemplo, o convite da
 *   criação venceu (24h) ou foi para um e-mail errado e foi revogado.
 *
 * Service role: a chamada é do painel da plataforma, cross-tenant de propósito,
 * e TODA consulta filtra `organization_id` pelo id do path.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type EstadoDoResponsavel =
  | { estado: "ativo"; email: string | null; desde: string }
  | {
      estado: "convite_pendente";
      email: string;
      convite_id: string;
      expira_em: string;
      expirado: boolean;
      email_enviado: boolean;
    }
  | { estado: "sem_responsavel" };

export async function responsavelDaOrganizacao(
  admin: SupabaseClient,
  organizationId: string,
  agora: Date = new Date(),
): Promise<EstadoDoResponsavel> {
  const { data: vinculo, error: erroDoVinculo } = await admin
    .from("user_organizations")
    .select("user_id, accepted_at")
    .eq("organization_id", organizationId)
    .eq("role", "admin")
    .is("revoked_at", null)
    .not("accepted_at", "is", null)
    .eq("provisional_until_handover", false)
    .order("accepted_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (erroDoVinculo) throw erroDoVinculo;

  if (vinculo) {
    const { data: conta } = await admin.auth.admin.getUserById(vinculo.user_id as string);
    return {
      estado: "ativo",
      email: conta?.user?.email ?? null,
      desde: vinculo.accepted_at as string,
    };
  }

  const { data: convite, error: erroDoConvite } = await admin
    .from("team_invites")
    .select("id, email, expires_at, email_dispatched")
    .eq("organization_id", organizationId)
    .eq("role", "admin")
    .is("accepted_at", null)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (erroDoConvite) throw erroDoConvite;

  if (convite) {
    return {
      estado: "convite_pendente",
      email: convite.email as string,
      convite_id: convite.id as string,
      expira_em: convite.expires_at as string,
      expirado: Date.parse(convite.expires_at as string) <= agora.getTime(),
      email_enviado: !!convite.email_dispatched,
    };
  }

  return { estado: "sem_responsavel" };
}
