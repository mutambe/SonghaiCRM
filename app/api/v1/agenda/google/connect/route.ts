/**
 * GET /api/v1/agenda/google/connect — começa a conexão da agenda do Google.
 *
 * Adaptado do upstream DeskcommCRM (`app/api/v1/agenda/google/connect/`), que
 * é a fonte de verdade das decisões abaixo — ver `lib/agenda/google/config.ts`
 * para o que mudou na adaptação.
 *
 * Manda a pessoa ao consentimento do Google com um `state` assinado que carrega
 * QUEM está conectando. É a metade de ida; a volta é o `callback` ao lado.
 *
 * A conexão é POR PESSOA (schema: `calendar_connections.unique(organization_id,
 * user_id, provider, account_email)`), e o piso de papel é `agent` — o mesmo
 * piso que a migration exige para escrever em `appointments`: conectar uma
 * agenda existe para alimentar compromissos.
 *
 * Todo desfecho — inclusive falha — volta para `/app/agenda?erro=<código>`,
 * nunca JSON: este endereço é aberto pelo NAVEGADOR, num clique de botão. A
 * exceção é falta de sessão/papel, onde o gate canônico (`requireRole`)
 * responde, porque a resposta dele já é a certa.
 */

import { randomBytes } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { CAMINHO_DO_CALLBACK, configuracaoDoGoogle, origemLocalDosCabecalhos } from "@/lib/agenda/google/config";
import { emitirEstado } from "@/lib/agenda/google/estado";
import { assinarVinculo, NOME_DO_VINCULO, VALIDADE_DO_VINCULO_S } from "@/lib/agenda/google/vinculo";
import { cookieSecure } from "@/lib/supabase/cookie-secure";
import { montarUrlDeConsentimento } from "@/lib/agenda/google/oauth";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

function voltarComErro(codigo: string): NextResponse {
  const base = env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return NextResponse.redirect(new URL(`/app/agenda?erro=${codigo}`, base));
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const requestId = req.headers.get("x-request-id") ?? undefined;

  const autorizado = await requireRole("agent", { requestId, resource: "calendar_connections" });
  if (!autorizado.ok) return autorizado.response;
  const { user, org } = autorizado;

  const app = configuracaoDoGoogle(origemLocalDosCabecalhos(req.headers) ?? undefined);
  if (!app) {
    // Não audita: não houve tentativa de conectar nada.
    return voltarComErro("google_nao_configurado");
  }

  // O nonce nasce AQUI porque precisa ser conhecido duas vezes: vai dentro do
  // `state` (viaja pela URL do Google) e assina o cookie de vínculo (fica no
  // navegador) — é o par que prova, na volta, que quem voltou é quem saiu.
  const nonce = randomBytes(16).toString("base64url");

  let state: string;
  try {
    state = emitirEstado(
      { organizationId: org.orgId, userId: user.id },
      { segredo: env.INTERNAL_SECRET, agora: new Date(), nonce },
    );
  } catch {
    await audit({
      action: "agenda.google.conexao_falhou",
      organizationId: org.orgId,
      metadata: { reason: "segredo_de_state_indisponivel" },
    });
    return voltarComErro("segredo_indisponivel");
  }

  // `contaSugerida` evita o erro mais comum do fluxo: autorizar com a conta
  // pessoal que já estava logada no navegador e ver a agenda errada aparecer.
  const url = montarUrlDeConsentimento(app, { state, contaSugerida: user.email });

  await audit({
    action: "agenda.google.conexao_iniciada",
    organizationId: org.orgId,
    metadata: { user_id: user.id },
  });

  const resposta = NextResponse.redirect(url);

  // `sameSite: "lax"` é o ponto deste cookie: é enviado em navegação top-level
  // GET vinda de outro site — que é exatamente a volta do consentimento.
  // `Strict` (o cookie de sessão do produto) não seria, e é por isso que este
  // cookie existe à parte — ver o cabeçalho de `lib/agenda/google/vinculo.ts`.
  resposta.cookies.set(NOME_DO_VINCULO, assinarVinculo(nonce, env.INTERNAL_SECRET), {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: CAMINHO_DO_CALLBACK,
    maxAge: VALIDADE_DO_VINCULO_S,
  });

  return resposta;
}
