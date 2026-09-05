/**
 * Paths that bypass auth check in middleware.
 * Match precedence: array order. First match wins.
 */
export const PUBLIC_PATHS: RegExp[] = [
  /^\/$/,
  /^\/login(\/.*)?$/,
  /^\/signup$/,
  /^\/auth\/confirm$/,
  /^\/403$/,
  /^\/admin\/forbidden$/,
  /^\/404$/,
  /^\/500$/,
  /^\/503$/,
  /^\/api\/v1\/health$/,
  /^\/api\/v1\/webhooks\//,
  /^\/api\/v1\/cron\//,
  // Licenciamento self-host (PaySuite) — chamadas de servidor-a-servidor, sem
  // cookie de sessão: instalações de CLIENTE chamam /verify e /renew (via
  // lib/licensing/central-client.ts, do cron licensing-refresh e do botão
  // "Renovar agora"), e o PaySuite chama o webhook. Cada uma valida a si
  // mesma por dentro (license_key desconhecida → 404; assinatura HMAC errada
  // → 401) — não é a mesma coisa que "sem autenticação nenhuma". As rotas
  // administrativas (`/api/v1/licensing/admin`, `/paysuite-credentials`) NÃO
  // entram aqui de propósito: essas são só a Central, pela tela, com sessão.
  // Achado em produção: sem isto, o webhook e o verify/renew devolviam 401
  // "Authentication required" pra QUALQUER chamador — o mecanismo inteiro de
  // licenciamento nunca teria funcionado.
  /^\/api\/v1\/licensing\/verify$/,
  /^\/api\/v1\/licensing\/renew$/,
  /^\/api\/v1\/licensing\/webhooks\/paysuite$/,
  // Heartbeat do agente do host (bearer INTERNAL_SECRET/INTERNAL_CRON_SECRET,
  // checado dentro da própria rota) — sem cookie de sessão, igual /cron/.
  /^\/api\/v1\/system\/agent$/,
  /^\/api\/internal\//,
  /^\/api\/mcp(\/.*)?$/,
  /^\/_next\//,
  /^\/favicon\.ico$/,
  // O ícone da aba (`app/icon.tsx`), que o `<head>` de TODA página pede —
  // inclusive o do `/login`, antes de existir sessão. Precisa de entrada
  // própria porque o matcher do `proxy.ts:128` só dispensa caminho COM
  // extensão: `/favicon.ico` passa por ele, `/icon` não. Medido em produção
  // antes desta linha: `GET /icon` → 307 para `/login?next=%2Ficon`, enquanto
  // `/icon.png` (inexistente) devolvia 404 — a diferença é só a extensão.
  /^\/icon$/,
  /^\/team\/accept-invite\/.+$/,
  /^\/account-suspended$/,
  // Documentos legais. O checkbox obrigatório de `/onboarding/welcome` linka os
  // dois, e o aceite acontece antes de a pessoa ter qualquer coisa no sistema —
  // exigir sessão para LER o que se está aceitando inverte a ordem. Âncorado nos
  // dois nomes de propósito: `/^\/legal/` deixaria qualquer sub-path futuro
  // nascer público de carona.
  /^\/legal\/(terms|privacy)$/,
];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((re) => re.test(pathname));
}
