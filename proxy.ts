import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookieSecure } from "@/lib/supabase/cookie-secure";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { isPublicPath } from "@/lib/auth/public-paths";
import {
  verifyImpersonateCookieEdge,
  IMPERSONATE_COOKIE_NAME_EDGE,
} from "@/lib/impersonate/cookie-edge";
import { createAdminClient } from "@/lib/supabase/admin";
import { avaliarAcesso } from "@/lib/licensing/gate";
import { LICENSING_PUBLIC_KEY_PEM } from "@/lib/licensing/chave-publica";

const COOKIE_NAME = "sb-deskcomm-auth";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Gate de assinatura self-host (licenciamento via PaySuite). `/api/v1/webhooks/*`
 * e `/api/v1/cron/*` já são `isPublicPath` e nunca chegam aqui — bloquear
 * entrega de webhook de terceiro ou o próprio cron que tira a instalação do
 * bloqueio (`licensing-refresh`) perderia dado, não é isso que "degradar"
 * deveria significar. Ver docs/superpowers/specs/2026-09-04-licenciamento-paysuite-design.md.
 */
async function bloqueadoPorLicenca(request: NextRequest): Promise<NextResponse | null> {
  if (!MUTATING_METHODS.has(request.method) || !request.nextUrl.pathname.startsWith("/api/v1/")) {
    return null;
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("licensing_client_state")
    .select("token, fetched_at")
    .eq("id", "singleton")
    .maybeSingle();

  const row = data as { token: string | null; fetched_at: string | null } | null;
  const decisao = avaliarAcesso(
    {
      token: row?.token ?? null,
      fetchedAt: row?.fetched_at ? new Date(row.fetched_at) : null,
    },
    new Date(),
    LICENSING_PUBLIC_KEY_PEM,
  );

  if (!decisao.bloqueado) {
    return null;
  }

  return NextResponse.json(
    {
      error: {
        code: "license_required",
        message:
          "Assinatura pendente. Regularize em Configurações › Billing para continuar criando ou editando dados.",
        details: { reason: decisao.motivo },
      },
    },
    { status: 403 },
  );
}

export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request: { headers: request.headers } });

  // Inject X-Request-Id for downstream correlation (audit log, error wrappers).
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  response.headers.set("x-request-id", requestId);

  const { pathname, search } = request.nextUrl;
  // Expose pathname to Server Components via header (used by onboarding layout).
  response.headers.set("x-pathname", pathname);
  request.headers.set("x-pathname", pathname);

  // EPIC-11: in dev we route by path (`/admin/*`); in prod the
  // `admin.deskcomm.com` sub-domain is mapped via Vercel rewrites to the same
  // `/admin/*` paths. The host-based branch below stays a NOOP today and only
  // exists as documentation of the intended deploy topology.
  const host = request.headers.get("host") ?? "";
  const isAdminSurface = host.startsWith("admin.") || pathname.startsWith("/admin");

  if (isPublicPath(pathname)) {
    return response;
  }

  const licenseBlock = await bloqueadoPorLicenca(request);
  if (licenseBlock) {
    return licenseBlock;
  }

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
      cookieOptions: {
        name: COOKIE_NAME,
        sameSite: "strict",
        httpOnly: true,
        secure: cookieSecure(),
        path: "/",
      },
    },
  );

  // Validate JWT server-side (NEVER use getSession on backend per CLAUDE.md).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // API routes must respond with JSON envelope (contract: {error:{code,message}})
    // — never redirect HTML to JSON consumers. UI routes redirect to /login as before.
    if (pathname.startsWith("/api/")) {
      return new NextResponse(
        JSON.stringify({
          error: {
            code: "unauthenticated",
            message: "Authentication required",
          },
        }),
        {
          status: 401,
          headers: {
            "content-type": "application/json",
            "x-request-id": requestId,
          },
        },
      );
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname + search);
    return NextResponse.redirect(loginUrl);
  }

  // EPIC-11 S-11.07: validate impersonate cookie on /app/* paths. Esta checagem
  // em si só faz HMAC + expiry (sem DB) — o runtime virou Node (não mais Edge)
  // com a Task 11 do licenciamento (`bloqueadoPorLicenca` acima precisa de
  // `node:crypto`/admin client), mas este bloco não passou a consultar banco.
  // On any failure we delete the cookie (defence-in-depth) and let the request
  // continue (the layout re-checks server-side; downstream code that depends
  // on the cookie will simply see no impersonation in effect).
  if (pathname.startsWith("/app")) {
    const impCookie = request.cookies.get(IMPERSONATE_COOKIE_NAME_EDGE)?.value;
    if (impCookie) {
      const result = await verifyImpersonateCookieEdge(
        impCookie,
        env.IMPERSONATE_COOKIE_SECRET ?? "",
      );
      if (!result.valid) {
        console.warn(
          `[middleware] impersonate cookie invalid (${result.reason ?? "unknown"}) — clearing`,
        );
        response.cookies.delete(IMPERSONATE_COOKIE_NAME_EDGE);
      }
    }
  }

  // /admin/* additionally requires platform_admin (early gate — authoritative
  // check is server-side in `requirePlatformAdmin`). Skip the RPC for
  // `/admin/forbidden` (rendered to non-admins, would otherwise loop).
  if (isAdminSurface && pathname.startsWith("/admin") && pathname !== "/admin/forbidden") {
    const { data: isAdmin, error } = await supabase.rpc("fn_is_platform_admin");
    if (error || !isAdmin) {
      return NextResponse.redirect(new URL("/admin/forbidden", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: [
    // Run on all paths except static assets / Next internals.
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)",
  ],
};
