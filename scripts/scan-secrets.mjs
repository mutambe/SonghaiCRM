#!/usr/bin/env node
/**
 * Scanner de segredos do pre-commit (issue do Tier 2 — não existia nenhum
 * hook local, então uma chave commitada por engano só era pega em revisão
 * humana, ou nunca).
 *
 * Dois caminhos, escolhidos em ordem:
 *
 *  1. `gitleaks` no PATH: delega pra ele (`gitleaks protect --staged`), que
 *     tem detecção por entropia + centenas de regras por serviço. Instale
 *     com `scoop install gitleaks` / `brew install gitleaks` / `go install
 *     github.com/gitleaks/gitleaks/v8@latest` pra cobertura completa.
 *  2. Sem `gitleaks`: cai num scanner por regex embutido, sem dependência
 *     nenhuma — cobre os formatos de token mais comuns (AWS, GitHub, Slack,
 *     Stripe, provedores de IA, blocos de chave privada). Menos preciso que
 *     o gitleaks, mas roda em QUALQUER clone sem instalar nada — a doutrina
 *     de packaging deste repo é clara: nada que dependa de passo manual do
 *     operador vira porta destrancada por padrão.
 *
 * Escaneia o CONTEÚDO staged de cada arquivo (não só o diff), porque um
 * segredo colado inteiro num arquivo novo não aparece como "+linha" de diff
 * incremental — é o arquivo inteiro que é novo.
 */
import { execFileSync, spawnSync } from "node:child_process";

function stagedFiles() {
  const out = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
    encoding: "utf-8",
  });
  return out.split("\n").map((l) => l.trim()).filter(Boolean);
}

/**
 * Arquivos com token/JWT de FIXTURE conhecido (demo do Supabase, valor
 * inventado pro teste) — medido em 2026-09-21 contra o repo inteiro
 * (`git ls-files`), únicos 2 hits reais dos padrões acima. Path exato, não
 * glob: a lista só encolhe quem já foi auditado, nunca isenta um diretório
 * inteiro por padrão.
 */
const ALLOWLIST_PATHS = new Set([
  "lib/audit/service-role-configured.test.ts",
  "tests/sonda-radar-isolamento-orgs.ts",
]);

function hasGitleaks() {
  const probe = spawnSync("gitleaks", ["version"], { stdio: "ignore" });
  return probe.status === 0;
}

function runGitleaks() {
  const res = spawnSync(
    "gitleaks",
    ["protect", "--staged", "--redact", "-v", "--config", ".gitleaks.toml"],
    { stdio: "inherit" },
  );
  return res.status === 0;
}

// Formatos conhecidos de token/chave — prefixo ou shape fixo, baixo risco de
// falso positivo. Deliberadamente NÃO inclui um heurístico de entropia
// genérico: sem gitleaks, entropia solta sobre qualquer `_KEY=`/`_SECRET=`
// pega hash de commit, UUID e afins e o hook vira ruído que o time aprende a
// ignorar — o pior desfecho para um gate de segurança.
const PADROES = [
  { nome: "AWS Access Key ID", re: /AKIA[0-9A-Z]{16}/ },
  { nome: "AWS Secret Access Key (atribuição explícita)", re: /aws_secret_access_key\s*=\s*[A-Za-z0-9/+=]{40}/i },
  { nome: "Bloco de chave privada", re: /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { nome: "Slack token", re: /xox[baprs]-[0-9A-Za-z-]{10,}/ },
  { nome: "GitHub token", re: /gh[pousr]_[A-Za-z0-9]{36,}/ },
  { nome: "Stripe live key", re: /(sk|rk)_live_[A-Za-z0-9]{24,}/ },
  { nome: "Anthropic API key", re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { nome: "OpenAI API key", re: /sk-[A-Za-z0-9]{20,}T3BlbkFJ[A-Za-z0-9]{20,}/ },
  { nome: "Google API key", re: /AIza[0-9A-Za-z_-]{35}/ },
  { nome: "Upstash/Supabase service JWT", re: /eyJhbGciOi[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
];

function runFallback(files) {
  let achou = false;
  for (const file of files) {
    if (ALLOWLIST_PATHS.has(file.replace(/\\/g, "/"))) continue;
    let conteudo;
    try {
      conteudo = execFileSync("git", ["show", `:${file}`], { encoding: "utf-8", maxBuffer: 1024 * 1024 * 32 });
    } catch {
      continue; // binário, arquivo removido, etc. — sem conteúdo de texto pra escanear
    }
    for (const { nome, re } of PADROES) {
      const m = conteudo.match(re);
      if (m) {
        achou = true;
        console.error(`\n  segredo suspeito (${nome}) em ${file}`);
        console.error(`    trecho: ${m[0].slice(0, 12)}…(redigido)`);
      }
    }
  }
  return !achou;
}

const files = stagedFiles();
if (files.length === 0) process.exit(0);

const ok = hasGitleaks() ? runGitleaks() : runFallback(files);

if (!ok) {
  console.error(
    "\npre-commit BLOQUEADO: possível segredo no que está staged.\n" +
      "Se for falso positivo, remova o arquivo do stage (git restore --staged <arquivo>) ou,\n" +
      "com gitleaks instalado, ajuste .gitleaks.toml. Nunca use --no-verify pra passar por cima\n" +
      "de um achado real.\n",
  );
  process.exit(1);
}
process.exit(0);
