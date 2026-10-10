/**
 * O GUARDA DO PACOTE nas rotas de `app/api/v1` (SonghaiCRM, migration 9008).
 *
 * Fica fora de `lib/auth/require-role.ts` de propósito: `requireRole`,
 * `orgAtivaDaApi` e `resolveAuthDual` chamam isto, e as rotas que não passam
 * por nenhum deles também. Um módulo próprio é um só ponto que nenhum teste de
 * rota precisa reimplementar quando substitui `require-role`.
 */
import { headers } from "next/headers";
import type { NextResponse } from "next/server";

import { fail, type ApiError } from "@/lib/api/wrappers";
import {
  funcionalidadeDaRotaApi,
  funcionalidadesDaOrganizacao,
  mensagemDeFuncionalidadeForaDoPlano,
} from "@/lib/plans/funcionalidades";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * O caminho da requisição que o `proxy.ts` escreveu (e sobrescreve sempre — o
 * cliente não escolhe). Fora de uma requisição (teste unitário) não há
 * cabeçalhos: `null`, e o plano não é consultado.
 */
async function caminhoDaRequisicao(): Promise<string | null> {
  try {
    return (await headers()).get("x-pathname");
  } catch {
    return null;
  }
}

/**
 * A rota é de uma funcionalidade que o pacote da organização NÃO inclui?
 * `null` = pode seguir; senão, o 403 `plan_feature_required`. O mapa de quais
 * rotas é `ROTAS_POR_FUNCIONALIDADE`. Dado nenhum é apagado: a rota apenas
 * recusa, e volta a servir se o plano subir. Falha ABERTA: ver
 * `lib/plans/funcionalidades.ts`.
 */
export async function recusaDoPlanoDaRota(
  orgId: string,
  requestId?: string,
): Promise<NextResponse<ApiError> | null> {
  const funcionalidade = funcionalidadeDaRotaApi(await caminhoDaRequisicao());
  if (!funcionalidade) return null;
  const incluidas = await funcionalidadesDaOrganizacao(createAdminClient(), orgId);
  if (incluidas.includes(funcionalidade)) return null;
  return fail("plan_feature_required", mensagemDeFuncionalidadeForaDoPlano(funcionalidade), 403, {
    requestId,
    details: { feature: funcionalidade },
  });
}
