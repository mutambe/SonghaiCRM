/**
 * SonghaiCRM — `docker-compose.swarm.yml` é o stack das VPS em Docker Swarm
 * (Portainer + Traefik). O do fork era uma CÓPIA à mão do compose de produção
 * com a lista de variáveis escrita serviço a serviço, e envelheceu em silêncio:
 * faltavam variáveis que o app passou a exigir, e o WAHA ainda pedia o evento
 * `message` que o produto tirou. Este teste prende o arquivo ao
 * `docker-compose.prod.yml`: o que é do PRODUTO (imagem, ambiente, webhook,
 * healthcheck, teto de memória) tem de ser igual; o que é do SWARM (labels no
 * deploy, rede overlay, sem caddy/voz/telefonia) tem de estar lá.
 *
 * Sem parser de YAML, no molde de `tests/unit/portas-do-compose.test.ts`: o
 * suficiente para "este serviço declara X?" sem dependência nova num gate.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = path.resolve(__dirname, "../..");
const ler = (f: string) => fs.readFileSync(path.join(RAIZ, f), "utf8");

/** Blocos de serviço (2 espaços) do topo `services:`. */
function servicos(yaml: string): Map<string, string[]> {
  const mapa = new Map<string, string[]>();
  let dentro = false;
  let atual: string | null = null;
  for (const linha of yaml.split("\n")) {
    if (/^services:\s*$/.test(linha)) {
      dentro = true;
      continue;
    }
    if (!dentro) continue;
    if (/^\S/.test(linha)) {
      dentro = false;
      atual = null;
      continue;
    }
    const cab = linha.match(/^ {2}([a-z0-9_-]+):\s*$/i);
    if (cab) {
      atual = cab[1]!;
      mapa.set(atual, []);
      continue;
    }
    if (atual && !/^\s*#/.test(linha) && linha.trim() !== "") mapa.get(atual)!.push(linha);
  }
  return mapa;
}

/** O valor de uma chave de 4 espaços, numa linha (`    image: x` → `x`). */
function valor(bloco: string[], chave: string): string | undefined {
  const l = bloco.find((x) => x.startsWith(`    ${chave}:`));
  return l?.slice(`    ${chave}:`.length).replace(/\s+#\s.*$/, "").trim();
}

/** As linhas de uma subseção de 4 espaços, sem indentação nem comentário no fim. */
function subsecao(bloco: string[], chave: string, recuo = 4): string[] {
  const i = bloco.findIndex((x) => x === `${" ".repeat(recuo)}${chave}:`);
  if (i < 0) return [];
  const saida: string[] = [];
  for (const linha of bloco.slice(i + 1)) {
    const r = linha.length - linha.trimStart().length;
    if (r <= recuo) break;
    saida.push(linha.trim().replace(/\s+#\s.*$/, ""));
  }
  return saida;
}

const PROD = servicos(ler("docker-compose.prod.yml"));
const SWARM_TXT = ler("docker-compose.swarm.yml");
const SWARM = servicos(SWARM_TXT);
const TRAEFIK = servicos(ler("docker-compose.traefik.yml"));

/** Os serviços que sobem SEMPRE no produto (sem profile), menos o proxy. */
const DO_PRODUTO = [...PROD.entries()]
  .filter(([nome, b]) => nome !== "caddy" && valor(b, "profiles") === undefined)
  .map(([nome]) => nome)
  .sort();

const NOSSAS = { app: "APP_IMAGE", worker: "WORKER_IMAGE", scheduler: "SCHEDULER_IMAGE" } as const;

describe("docker-compose.swarm.yml acompanha o compose de produção", () => {
  it("tem exatamente os serviços que sobem sempre — sem caddy, voz nem telefonia", () => {
    // O `docker stack deploy` ignora `profiles`: um serviço opcional aqui subiria em toda instalação.
    expect(DO_PRODUTO).toEqual(["app", "redis", "scheduler", "srh", "waha", "worker"]);
    expect([...SWARM.keys()].sort()).toEqual(DO_PRODUTO);
    for (const [nome, b] of SWARM) {
      for (const proibida of ["profiles", "build", "ports", "mem_limit", "restart", "pull_policy", "depends_on", "labels"]) {
        expect(valor(b, proibida), `${nome}: \`${proibida}\` não vale (ou não serve) no Swarm`).toBeUndefined();
      }
    }
  });

  it("as três imagens nossas usam a MESMA variável do produto, e sem canal móvel de reserva", () => {
    for (const [nome, variavel] of Object.entries(NOSSAS)) {
      expect(valor(PROD.get(nome)!, "image"), nome).toMatch(new RegExp(`^\\$\\{${variavel}:-`));
      expect(valor(SWARM.get(nome)!, "image"), nome).toMatch(new RegExp(`^\\$\\{${variavel}:\\?`));
    }
  });

  it("WAHA, redis e srh: mesma imagem do produto", () => {
    for (const nome of ["waha", "redis", "srh"]) {
      expect(valor(SWARM.get(nome)!, "image"), nome).toBe(valor(PROD.get(nome)!, "image"));
    }
  });

  it("ambiente, comando, volumes e healthcheck são os do produto (o webhook do WAHA inclusive)", () => {
    for (const nome of DO_PRODUTO) {
      const p = PROD.get(nome)!;
      const s = SWARM.get(nome)!;
      expect(subsecao(s, "environment"), `${nome}: environment`).toEqual(subsecao(p, "environment"));
      expect(subsecao(s, "volumes"), `${nome}: volumes`).toEqual(subsecao(p, "volumes"));
      expect(subsecao(s, "healthcheck"), `${nome}: healthcheck`).toEqual(subsecao(p, "healthcheck"));
      expect(valor(s, "command"), `${nome}: command`).toBe(valor(p, "command"));
    }
  });

  it("quem lê o .env no produto lê o .env INTEIRO aqui (nada de lista à mão)", () => {
    expect(SWARM_TXT).toMatch(/^x-env: &env-da-instalacao\n {2}- \$\{SWARM_ENV_FILE:-stack\.env\}$/m);
    for (const nome of DO_PRODUTO) {
      const leNoProduto = valor(PROD.get(nome)!, "env_file") !== undefined;
      expect(valor(SWARM.get(nome)!, "env_file"), nome).toBe(leNoProduto ? "*env-da-instalacao" : undefined);
    }
  });

  it("o teto de memória é o mesmo, no lugar que o Swarm lê, e todo serviço reinicia", () => {
    for (const nome of DO_PRODUTO) {
      const p = PROD.get(nome)!;
      const s = SWARM.get(nome)!;
      const deploy = subsecao(s, "deploy");
      const teto = valor(p, "mem_limit");
      if (teto) expect(deploy, nome).toContain(`memory: ${teto.toUpperCase()}`);
      expect(deploy, `${nome}: sem restart_policy o serviço não volta`).toContain("restart_policy: *reinicio");
    }
  });

  it("as regras do Traefik são as do docker-compose.traefik.yml, nas labels do DEPLOY", () => {
    const doCompose = subsecao(TRAEFIK.get("app")!, "labels").filter((l) => !l.startsWith("traefik.docker.network:"));
    const doSwarm = subsecao(SWARM.get("app")!, "labels", 6);
    expect(doCompose.length).toBeGreaterThan(10);
    for (const label of doCompose) expect(doSwarm, label).toContain(label);
    expect(doSwarm).toContain('traefik.swarm.network: "${TRAEFIK_NETWORK_SWARM:-traefik_public}"');
    expect(doSwarm).toContain('traefik.docker.network: "${TRAEFIK_NETWORK_SWARM:-traefik_public}"');
  });

  it("rede interna é overlay; a do Traefik é externa; só o app fica nas duas", () => {
    expect(SWARM_TXT).toMatch(/^networks:\n {2}internal:\n {4}driver: overlay\n {2}proxy:\n {4}external: true\n {4}name: "\$\{TRAEFIK_NETWORK_SWARM:-traefik_public\}"\n?$/m);
    for (const [nome, b] of SWARM) {
      const redes = valor(b, "networks") || subsecao(b, "networks").join(",");
      expect(redes, nome).toBe(nome === "app" ? "- internal,- proxy" : "[internal]");
    }
  });

  it("o WAHA fica preso ao nó das sessões", () => {
    expect(subsecao(SWARM.get("waha")!, "deploy")).toContain("- node.role == manager");
  });
});

describe("deploy-swarm.sh aplica o banco antes das imagens", () => {
  // Só as linhas de CÓDIGO: o cabeçalho cita as mesmas funções ao explicar a ordem.
  const script = ler("hostgator-setup-kit/deploy-swarm.sh")
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
  const posicao = (trecho: string) => {
    const i = script.indexOf(trecho);
    expect(i, trecho).toBeGreaterThan(-1);
    return i;
  };

  it("backup → banco → imagens pinadas → stack deploy, nesta ordem", () => {
    const backup = posicao("pg_dump");
    const banco = posicao("reaplicar_baseline");
    const imagens = posicao("gravar_imagens .env");
    const deploy = posicao("docker stack deploy");
    expect(backup).toBeLessThan(banco);
    expect(banco).toBeLessThan(imagens);
    expect(imagens).toBeLessThan(deploy);
  });

  it("a versão vem da release publicada, e o stack lê o .env inteiro", () => {
    expect(script).toContain("ultima_release_estavel");
    expect(script).toMatch(/SWARM_ENV_FILE=\.env docker stack deploy/);
  });
});
