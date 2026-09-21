/**
 * GET /api/v1/agenda/google/callback — a volta do consentimento do Google.
 *
 * Adaptado do upstream DeskcommCRM. Confere o `state`, troca o código por
 * tokens, descobre de quem é a agenda, cifra e grava a conexão. É retorno de
 * NAVEGADOR: todo desfecho — inclusive cada falha — volta para `/app/agenda`
 * com `?erro=<código>` ou `?ok=1`, nunca JSON.
 *
 * ─── A ORDEM DOS PASSOS É CONTRATO ─────────────────────────────────────────
 * 1. `error` na query ANTES de tudo — quem clicou "Cancelar" não é falha.
 * 2. `state` ANTES do `code` — sem org não há o que auditar.
 * 3. VÍNCULO logo depois do `state`, antes de qualquer efeito — prova que quem
 *    voltou é o mesmo navegador que saiu (ver `lib/agenda/google/vinculo.ts`).
 * 4. QUEIMA DO NONCE antes de trocar o código — senão um `state` repetido
 *    gastaria o `code` do Google (uso único) antes de acusar o replay, e quem
 *    apresentasse o legítimo receberia "código já usado".
 * 5. Escopo DEPOIS da troca, ANTES de gravar — a tela do Google deixa
 *    desmarcar escopo por escopo.
 * 6. Cifra ANTES do upsert — gravar o token em claro por um instante é
 *    gravá-lo em claro.
 *
 * ─── POR QUE A VOLTA É UMA PÁGINA-PONTE, E NÃO UM REDIRECT ────────────────
 *
 * Isto era `NextResponse.redirect`, e o upstream mediu em produção (v1.9.0)
 * que isso DESLOGAVA a pessoa depois de conectar: um 307 daqui para
 * `/app/agenda` ainda pertence à cadeia de navegação iniciada em
 * `accounts.google.com`. O cookie de sessão deste produto é `SameSite=Strict`
 * (CLAUDE.md — "Cookie SameSite=Strict, HttpOnly, Secure") e não viaja com
 * initiator cross-site, então o middleware não enxergava usuário e mandava
 * para `/login`. A ponte resolve porque muda QUEM INICIA a navegação: o HTML
 * volta com 200 no nosso próprio origin, e o `location.replace` seguinte é
 * disparado por um documento nosso — initiator same-site, o cookie Strict
 * viaja. Este mesmo defeito se aplicaria aqui: o fork usa o mesmo Strict.
 */

import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { PROVEDOR_GOOGLE } from "@/lib/agenda/tipos";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";
import { CAMINHO_DO_CALLBACK, configuracaoDoGoogle, origemLocalDosCabecalhos } from "@/lib/agenda/google/config";
import { verificarEstado } from "@/lib/agenda/google/estado";
import { NOME_DO_VINCULO, vinculoConfere } from "@/lib/agenda/google/vinculo";
import { cookieSecure } from "@/lib/supabase/cookie-secure";
import { escoposFaltando } from "@/lib/agenda/google/oauth";
import { trocarCodigoPorToken } from "@/lib/agenda/google/token";
import { contaDaAgendaPrimaria } from "@/lib/agenda/google/calendarios";
import { classificarErroDoGoogle } from "@/lib/agenda/google/erros";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

function voltar(parametro: string): NextResponse {
  const base = env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const destino = new URL(`/app/agenda?${parametro}`, base).toString();
  const seguro = destino
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const resposta = new NextResponse(
    `<!doctype html><html lang="pt-br"><head><meta charset="utf-8">` +
      `<meta name="robots" content="noindex">` +
      `<noscript><meta http-equiv="refresh" content="0;url=${seguro}"></noscript>` +
      `<title>Voltando…</title></head><body>` +
      `<p>Voltando para a sua agenda…</p>` +
      `<script>location.replace(${JSON.stringify(destino)})</script>` +
      `<noscript><p><a href="${seguro}">Continuar</a></p></noscript>` +
      `</body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
  // A limpeza mora aqui, e não em cada saída, porque toda volta — sucesso e
  // erro — passa por esta função.
  resposta.cookies.set(NOME_DO_VINCULO, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: CAMINHO_DO_CALLBACK,
    maxAge: 0,
  });
  return resposta;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const recusa = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const stateBruto = url.searchParams.get("state");

  // 1. A pessoa desistiu. Não é falha.
  if (recusa) return voltar("erro=conexao_cancelada");

  // 2. Quem está voltando? `verificarEstado` LANÇA quando o segredo é curto
  //    demais — esta rota é pública (sem sessão), então fica sob `try`: um
  //    throw aqui seria 500 anônimo, alcançável em laço.
  let estado: ReturnType<typeof verificarEstado> = null;
  try {
    estado = verificarEstado(stateBruto, { segredo: env.INTERNAL_SECRET, agora: new Date() });
  } catch {
    return voltar("erro=retorno_nao_verificavel");
  }
  if (!estado) {
    await audit({
      action: "agenda.google.conexao_falhou",
      metadata: { reason: "state_invalido" },
    });
    return voltar("erro=retorno_nao_verificavel");
  }
  const { organizationId, userId } = estado;

  // 3. QUEM VOLTOU É QUEM SAIU — antes da queima do nonce. Queimar antes
  //    daria a quem tem um `state` vazado um botão de negação de serviço:
  //    queima, e o dono legítimo recebe "state_reutilizado" ao voltar de
  //    verdade. Os dois ramos falham com a MESMA mensagem, de propósito.
  const vinculo = req.cookies.get(NOME_DO_VINCULO)?.value;
  if (!vinculoConfere(vinculo, estado.nonce, env.INTERNAL_SECRET)) {
    await audit({
      action: "agenda.google.conexao_falhou",
      organizationId,
      metadata: { reason: "vinculo_ausente_ou_nao_confere", user_id: userId },
    });
    return voltar("erro=retorno_nao_verificavel");
  }

  if (!code) {
    await audit({
      action: "agenda.google.conexao_falhou",
      organizationId,
      metadata: { reason: "sem_codigo", user_id: userId },
    });
    return voltar("erro=retorno_incompleto");
  }

  const app = configuracaoDoGoogle(origemLocalDosCabecalhos(req.headers) ?? undefined);
  if (!app) return voltar("erro=google_nao_configurado");

  // 4. QUEIMA DO NONCE — antes de trocar o código, não depois. A PK da tabela
  //    é o próprio nonce: a segunda tentativa viola a unicidade.
  const admin = createAdminClient();
  const { error: erroDoNonce } = await admin.from("calendar_oauth_nonces").insert({
    nonce: estado.nonce,
    organization_id: organizationId,
    user_id: userId,
    expira_em: new Date(estado.expiraEmMs).toISOString(),
  });
  if (erroDoNonce) {
    await audit({
      action: "agenda.google.conexao_falhou",
      organizationId,
      metadata: {
        reason: erroDoNonce.code === "23505" ? "state_reutilizado" : "nonce_indisponivel",
        user_id: userId,
      },
    });
    return voltar("erro=retorno_nao_verificavel");
  }

  // 5. Troca o código pelos tokens.
  const leitura = await trocarCodigoPorToken(app, code, { agora: new Date() });
  if (!leitura.ok) {
    await audit({
      action: "agenda.google.conexao_falhou",
      organizationId,
      metadata: { reason: leitura.motivo, detalhe: leitura.detalhe, user_id: userId },
    });
    return voltar("erro=troca_de_codigo_falhou");
  }
  const token = leitura.token;

  // 6. A pessoa desmarcou algum escopo obrigatório?
  const faltando = escoposFaltando(token.scope);
  if (faltando.length > 0) {
    await audit({
      action: "agenda.google.conexao_falhou",
      organizationId,
      metadata: { reason: "scope_missing", faltando, user_id: userId },
    });
    return voltar("erro=permissao_incompleta");
  }

  // 7. De quem é a agenda, e em que fuso ela vive.
  const conta = await contaDaAgendaPrimaria(token.access_token);
  if (!conta.ok) {
    const classificacao = classificarErroDoGoogle(conta.erro, "listar");
    await audit({
      action: "agenda.google.conexao_falhou",
      organizationId,
      metadata: {
        reason: "conta_indisponivel",
        detalhe: conta.detalhe,
        motivo_do_google: classificacao.motivo,
        mensagem_do_google: classificacao.mensagem,
        user_id: userId,
      },
    });
    if (classificacao.desfecho === "sem_permissao") return voltar("erro=google_recusou_o_acesso");
    return voltar("erro=conta_indisponivel");
  }

  // 8. Cifra ANTES de gravar. Sem `refresh_token` a conexão nasce morta e
  //    parece viva (funciona por ~1h e para calada) — salvo reconexão, onde
  //    quem já tem chave guardada para ESTA conta não precisa de outra.
  let refreshJaGuardado = false;
  if (!token.refresh_token) {
    const { data: existente } = await admin
      .from("calendar_connections")
      .select("oauth_refresh_token_encrypted")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .eq("provider", PROVEDOR_GOOGLE)
      .eq("account_email", conta.conta.email)
      .maybeSingle();
    refreshJaGuardado = Boolean(existente?.oauth_refresh_token_encrypted);

    if (!refreshJaGuardado) {
      await audit({
        action: "agenda.google.conexao_falhou",
        organizationId,
        metadata: { reason: "sem_token_de_renovacao", user_id: userId },
      });
      return voltar("erro=sem_token_de_renovacao");
    }
  }

  const accessCifrado = await encryptWebhookSecret(admin, token.access_token);
  const refreshCifrado = token.refresh_token ? await encryptWebhookSecret(admin, token.refresh_token) : null;
  if (!accessCifrado || (token.refresh_token && !refreshCifrado)) {
    await audit({
      action: "agenda.google.conexao_falhou",
      organizationId,
      metadata: { reason: "cifra_indisponivel", user_id: userId },
    });
    return voltar("erro=cifra_indisponivel");
  }

  // 9. Grava. `organization_id`/`user_id` vêm do `state` ASSINADO, nunca da
  //    query — service role bypassa RLS, então o filtro é programático.
  const { data: conexaoGravada, error: erroAoGravar } = await admin
    .from("calendar_connections")
    .upsert(
      {
        organization_id: organizationId,
        user_id: userId,
        provider: PROVEDOR_GOOGLE,
        account_email: conta.conta.email,
        oauth_access_token_encrypted: accessCifrado,
        // Quando o Google não reenviou a chave e já havia uma guardada, a
        // coluna fica FORA do upsert — omitir preserva; `null` apagaria a
        // chave que faz a conexão sobreviver à primeira hora.
        ...(refreshCifrado ? { oauth_refresh_token_encrypted: refreshCifrado } : {}),
        token_expires_at: token.expira_em,
        scopes: token.scope,
        status: "healthy",
        last_sync_error: null,
      },
      { onConflict: "organization_id,user_id,provider,account_email" },
    )
    .select("id")
    .single();

  if (erroAoGravar) {
    await audit({
      action: "agenda.google.conexao_falhou",
      organizationId,
      metadata: { reason: "upsert_falhou", detalhe: erroAoGravar.message, user_id: userId },
    });
    return voltar("erro=nao_consegui_guardar");
  }

  // 10. Registra o calendário PRIMÁRIO. Só ele, de propósito: registrar todos
  //     faria agenda de aniversário/terceiros ocupar horário sem a pessoa ter
  //     escolhido. Escolher entre vários é tela da Fase 2.
  if (conexaoGravada?.id) {
    const { error: erroDoCalendario } = await admin.from("calendar_connection_calendars").upsert(
      {
        organization_id: organizationId,
        connection_id: conexaoGravada.id,
        external_calendar_id: conta.conta.email,
        name: conta.conta.email,
        is_primary: true,
        time_zone: conta.conta.fuso,
      },
      { onConflict: "organization_id,connection_id,external_calendar_id" },
    );
    if (erroDoCalendario) {
      await audit({
        action: "agenda.google.conexao_falhou",
        organizationId,
        metadata: {
          reason: "calendario_primario_nao_registrado",
          detalhe: erroDoCalendario.message,
          user_id: userId,
        },
      });
    }
  }

  await audit({
    actorUserId: userId,
    action: "agenda.google.conexao_concluida",
    organizationId,
    metadata: { user_id: userId, account_email: conta.conta.email, fuso: conta.conta.fuso },
  });

  return voltar("ok=agenda_conectada");
}
