/**
 * ENDEREÇOS CONHECIDOS PARA O PROVEDOR PERSONALIZADO — SonghaiCRM.
 *
 * O fork antigo tinha NVIDIA, Groq, Qwen, Zhipu e Moonshot como provedores
 * próprios, cada um costurado em seis arquivos do núcleo (registry, validador,
 * runtime, prova de crédito…) — atrito garantido a cada `git merge upstream/main`.
 * Todos falam a API da OpenAI num endereço público `https://`, que é exatamente
 * o que o "Provedor personalizado" do upstream já executa, com a régua anti-SSRF,
 * o teste em `GET /models` antes de gravar e a lista de modelos vinda do próprio
 * endpoint. O que faltava era só o operador não precisar SABER o endereço: esta
 * lista preenche o campo. Nada aqui executa nada — escolher um item só escreve o
 * endereço, que segue pela mesma validação de qualquer outro.
 *
 * Fora daqui de propósito: Ollama e 9Router em `localhost`. O upstream recusa
 * endereço da rede interna porque, com várias organizações na mesma instalação,
 * abrir essa porta para a credencial de uma delas deixaria essa organização ler
 * os serviços internos da instalação (`docs/features/provedor-personalizado.md`).
 * Um 9Router ou Ollama exposto num endereço público https continua entrando,
 * digitado à mão.
 *
 * Sem link do painel de chaves de cada um: esses hosts são de categoria fechada
 * em `tests/unit/branding.test.ts`, e abri-la seria editar a lista do upstream.
 */
export interface EnderecoConhecido {
  id: string;
  /** Nome como o operador conhece — também vira o nome sugerido da credencial. */
  rotulo: string;
  baseUrl: string;
}

export const ENDERECOS_CONHECIDOS = [
  {
    id: "nvidia",
    rotulo: "NVIDIA NIM",
    baseUrl: "https://integrate.api.nvidia.com/v1",
  },
  {
    id: "groq",
    rotulo: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
  },
  {
    id: "qwen",
    rotulo: "Qwen (Alibaba DashScope)",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  },
  {
    id: "zhipu",
    rotulo: "Zhipu (GLM)",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  },
  {
    id: "moonshot",
    rotulo: "Moonshot (Kimi)",
    baseUrl: "https://api.moonshot.ai/v1",
  },
] as const satisfies readonly EnderecoConhecido[];

/** O item cujo endereço é exatamente este — para a tela mostrar qual está escolhido. */
export function enderecoConhecidoPorUrl(url: string): EnderecoConhecido | undefined {
  const alvo = url.trim().replace(/\/+$/, "");
  return ENDERECOS_CONHECIDOS.find((e) => e.baseUrl === alvo);
}
