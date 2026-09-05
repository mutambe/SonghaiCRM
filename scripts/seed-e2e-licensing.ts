/**
 * Seed E2E do gate de licenciamento self-host (PaySuite): sem isto, TODA
 * mutação (`POST/PUT/PATCH/DELETE` em `/api/v1/*`) volta 403
 * `license_required` num banco fresco — é o comportamento CORRETO de uma
 * instalação sem `licensing_client_state` populado, mas quebra qualquer
 * spec que crie dado, o que é a maioria da suíte.
 *
 * NÃO reusa a chave privada real da Central (ela nunca existe fora do
 * `.env` dela, de propósito — commitar até uma cópia de teste dela num
 * script do repo permitiria qualquer clone forjar um token que a chave
 * pública REAL (embutida em `lib/licensing/chave-publica.ts`) aceitaria).
 * Em vez disso, gera um par Ed25519 EFÊMERO aqui, assina um token "sempre
 * válido" com a privada efêmera, e grava a pública efêmera em
 * `LICENSING_PUBLIC_KEY_PEM_TEST_OVERRIDE` — só essa variável, nunca
 * documentada como algo pra colocar no `.env` real, faz `proxy.ts`/a tela de
 * billing aceitarem tokens assinados por ela (`lib/licensing/chave-publica.ts:
 * resolvePublicKeyPem`).
 *
 * Roda ANTES do `next start` da suíte (na mesma etapa das outras fixtures),
 * e escreve a var em `.env.e2e`/`.env.local` — o `next start` lê esses
 * arquivos do disco a cada boot, então não precisa reexportar pro
 * `$GITHUB_ENV` do job.
 *
 * Run: npx tsx scripts/seed-e2e-licensing.ts
 */
import { createClient } from "@supabase/supabase-js";
import { generateKeyPairSync } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { signLicenseToken } from "../lib/licensing/token";
import { anunciarDestino, credenciaisSupabaseDeTeste } from "./lib/env-de-teste";

const credenciais = credenciaisSupabaseDeTeste();
anunciarDestino("seed-e2e-licensing", credenciais);

if (!credenciais.url || !credenciais.serviceRole) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY para o seed de licenciamento.");
}

const admin = createClient(credenciais.url, credenciais.serviceRole, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * Reusa o par já gravado num `.env.e2e` anterior — mesma lógica de
 * `scripts/gerar-env-e2e.sh` reaproveitando `CHAVE_NUIT`/`CHAVE_WAHA`/
 * `CHAVE_AI`. Sem isto, rodar este seed uma 2ª vez localmente (sem apagar
 * `.env.e2e`) geraria uma chave pública nova só no arquivo — a antiga já
 * publicada em `$GITHUB_ENV`/lida por um `next start` anterior ficaria
 * dessincronizada da privada nova usada pra assinar o token.
 */
function lerVarExistente(nome: string): string | null {
  for (const arquivo of [".env.e2e", ".env.local"]) {
    const caminho = path.join(process.cwd(), arquivo);
    if (!fs.existsSync(caminho)) continue;
    const match = fs.readFileSync(caminho, "utf8").match(new RegExp(`^${nome}=(.+)$`, "m"));
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

const publicoExistente = lerVarExistente("LICENSING_PUBLIC_KEY_PEM_TEST_OVERRIDE");
const privadaExistente = lerVarExistente("LICENSING_TEST_SIGNING_PRIVATE_KEY_B64");

let publicPemB64: string;
let privatePemB64: string;
if (publicoExistente && privadaExistente) {
  publicPemB64 = publicoExistente;
  privatePemB64 = privadaExistente;
} else {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  publicPemB64 = Buffer.from(publicKey.export({ type: "spki", format: "pem" }).toString()).toString("base64");
  privatePemB64 = Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" }).toString()).toString(
    "base64",
  );
}

// 10 anos — a suíte não precisa exercitar expiração de licença, só não ser
// bloqueada por ela; `system-update.spec.ts`/os specs de billing têm suas
// próprias fixtures se algum dia precisarem testar o estado vencido.
const currentPeriodEnd = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString();
const token = signLicenseToken(
  { license_id: "e2e-fixture", status: "active", current_period_end: currentPeriodEnd },
  privatePemB64,
);

function anexarVar(arquivo: string, nome: string, valor: string): void {
  const caminho = path.join(process.cwd(), arquivo);
  if (!fs.existsSync(caminho)) return;
  const conteudo = fs.readFileSync(caminho, "utf8");
  if (conteudo.includes(`${nome}=`)) return; // já gravada (reaproveitada acima)
  fs.appendFileSync(caminho, `\n${nome}=${valor}\n`);
}

async function main() {
  const { error } = await admin.from("licensing_client_state").upsert({
    id: "singleton",
    token,
    fetched_at: new Date().toISOString(),
  });
  if (error) {
    throw new Error(`Falha ao semear licensing_client_state: ${error.message}`);
  }

  for (const arquivo of [".env.e2e", ".env.local"]) {
    anexarVar(arquivo, "LICENSING_PUBLIC_KEY_PEM_TEST_OVERRIDE", publicPemB64);
    // Só pra este script poder reaproveitar o par numa próxima rodada local —
    // o app nunca lê isto (não está em lib/env.ts).
    anexarVar(arquivo, "LICENSING_TEST_SIGNING_PRIVATE_KEY_B64", privatePemB64);
  }

  console.info("[seed-e2e-licensing] licensing_client_state semeado (status=active, 10 anos de validade)");
}

main().catch((err) => {
  console.error("[seed-e2e-licensing] falhou:", err);
  process.exit(1);
});
