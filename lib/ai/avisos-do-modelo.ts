/**
 * AVISOS NA CENTRAL SOBRE O QUE O MODELO ESCOLHIDO NÃO ACEITA (SonghaiCRM,
 * 08/10/2026).
 *
 * Regra do dono: o sistema NUNCA troca de modelo sozinho. Quando o modelo
 * escolhido recusa algo, o sistema retira só o que ele recusa (ou deixa a
 * falha aparecer) e AVISA. A escolha é sempre de quem administra.
 *
 * Dois avisos:
 *  - «amostragem retirada»: a organização tem temperature/top_p/top_k
 *    configurados e o modelo os recusa — foram retirados da chamada;
 *  - «modelo a recusar»: o provedor devolveu 400 a um modelo escolhido no
 *    painel ou no agente — o ponto está a falhar em cada chamada.
 *
 * Ambos são `kind = 'other'`, sem referência, deduplicados pelo TÍTULO
 * enquanto houver um aberto: uma rajada de falhas é UM aviso, não centenas.
 * Falha ao gravar vira só log — o aviso nunca impede a chamada nem esconde o
 * erro original. Mesmo desenho de `registrarRecusaDeEnderecoSemChave`
 * (`lib/agent-engine/edge/llm/run-model-call.ts`).
 *
 * O motor escreve por `pg`; o worker de sentimento, pelo cliente Supabase.
 * Texto e deduplicação são os mesmos nos dois.
 */
import type pg from "pg";

import type { createAdminClient } from "@/lib/supabase/admin";

import { avisoDaAmostragemNaEscolha } from "./amostragem";
import { idDoModelo } from "./esforco";

type Admin = ReturnType<typeof createAdminClient>;

export interface AvisoDoModelo {
  severity: "info" | "warn";
  title: string;
  body: string;
}

/**
 * `true` quando o 400 é do TAMANHO do pedido (prompt maior que a janela do
 * modelo, `max_tokens` acima do teto), e não do modelo recusar o pedido. Esse
 * caso se corrige no conteúdo, e o aviso «o modelo está a recusar os pedidos»
 * mandaria quem administra trocar um modelo que está certo.
 */
export function ehErroDeTamanho(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /prompt is too long|context (window|length)|maximum context|too many tokens|exceeds? (the )?(maximum|limit|max)|max_tokens.*(maximum|exceed|greater)|input is too long/i.test(
    msg,
  );
}

function nomeDoModelo(modelId: string): string {
  return idDoModelo(modelId);
}

/** Aviso: a amostragem configurada na organização foi retirada da chamada. */
export function avisoDeAmostragemRetirada(p: { modelId: string; retirados: string[] }): AvisoDoModelo {
  const modelo = nomeDoModelo(p.modelId);
  const lista = p.retirados.join(", ");
  return {
    severity: "info",
    title: `O modelo «${modelo}» ignora a configuração de ${lista}`,
    body:
      `O modelo ${modelo} ignora a temperature/top_p/top_k configurados na organização (${lista}): ` +
      `foram retirados dos pedidos, porque este modelo os recusa. Nada foi alterado no modelo. ` +
      `Se quiser outra afinação, escolha um modelo anterior que a aceite em IA › Provedores.`,
  };
}

/** Aviso: o provedor recusa os pedidos feitos ao modelo escolhido. */
export function avisoDeModeloARecusar(p: {
  rotuloDoPonto: string;
  modelId: string;
  origem: "binding" | "agente_publicado";
}): AvisoDoModelo {
  const onde =
    p.origem === "agente_publicado"
      ? "Abra IA › Agentes, escolha o agente e corrija o modelo na aba do modelo."
      : "Abra IA › Provedores e escolha outro modelo para este ponto.";
  return {
    severity: "warn",
    title: `O modelo escolhido para «${p.rotuloDoPonto}» está a recusar os pedidos`,
    body:
      `O provedor devolveu erro de pedido inválido ao modelo ${nomeDoModelo(p.modelId)}. ` +
      `Enquanto isso durar, este ponto falha em cada chamada. ${onde} ` +
      `O sistema não troca de modelo sozinho.`,
  };
}

/** Grava pelo `pg` (motor do agente). Devolve `true` se abriu um aviso novo. */
export async function abrirAvisoPorPg(
  db: pg.Pool,
  organizationId: string,
  aviso: AvisoDoModelo,
  log?: { warn: (msg: string, meta?: Record<string, unknown>) => void },
): Promise<boolean> {
  try {
    const { rowCount } = await db.query(
      `insert into agent_inbox_items (organization_id, kind, severity, title, body)
       select $1, 'other', $2, $3, $4
       where not exists (
         select 1 from agent_inbox_items
         where organization_id = $1 and kind = 'other' and title = $3 and status = 'open'
       )`,
      [organizationId, aviso.severity, aviso.title, aviso.body],
    );
    return (rowCount ?? 0) > 0;
  } catch (err) {
    log?.warn("llm: o aviso do modelo não abriu — a chamada segue", {
      organization_id: organizationId,
      causa: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/** Grava pelo cliente Supabase (workers). Devolve `true` se abriu um aviso novo. */
export async function abrirAvisoPorSupabase(
  admin: Admin,
  organizationId: string,
  aviso: AvisoDoModelo,
  log?: { warn: (msg: string, meta?: Record<string, unknown>) => void },
): Promise<boolean> {
  try {
    const { data: aberto } = await admin
      .from("agent_inbox_items")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("kind", "other")
      .eq("title", aviso.title)
      .eq("status", "open")
      .limit(1)
      .maybeSingle();
    if (aberto) return false;
    const { error } = await admin.from("agent_inbox_items").insert({
      organization_id: organizationId,
      kind: "other",
      severity: aviso.severity,
      title: aviso.title,
      body: aviso.body,
    });
    if (error) throw new Error(error.message);
    return true;
  } catch (err) {
    log?.warn("sentimento: o aviso do modelo não abriu — o erro original segue", {
      organization_id: organizationId,
      causa: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * A frase de aviso (já sem tradução) quando a organização tem amostragem
 * configurada e o modelo `provider/modelId` a recusa; `null` caso contrário ou
 * se a leitura falhar — o aviso nunca impede a ação que o originou.
 */
export async function avisoDeAmostragemDaOrganizacao(
  admin: Admin,
  organizationId: string,
  provider: string,
  modelId: string,
): Promise<string | null> {
  try {
    const { data } = await admin
      .from("organizations")
      .select("settings")
      .eq("id", organizationId)
      .maybeSingle();
    const params = (data?.settings as { llm?: { params?: unknown } } | null)?.llm?.params;
    return avisoDaAmostragemNaEscolha(provider, modelId, params);
  } catch {
    return null;
  }
}
