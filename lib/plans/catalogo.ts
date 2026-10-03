/**
 * Os pacotes do SonghaiCRM — os MESMOS slugs semeados em `public.plans`
 * (migration 9004). Fonte única para o formulário de nova organização e para o
 * esquema que a valida: o CHECK de `plans.slug` é o par no banco.
 *
 * Preço e limites NÃO moram aqui: são do banco (o admin pode mudar o catálogo
 * sem nova imagem). Aqui só o que identifica o pacote numa lista.
 */
export const SLUGS_DE_PLANO = ["agente_simples", "agente_medio", "agente_avancado", "enterprise"] as const;
export type SlugDePlano = (typeof SLUGS_DE_PLANO)[number];

export const PLANO_PADRAO: SlugDePlano = "agente_simples";

export const NOME_DO_PLANO: Readonly<Record<SlugDePlano, string>> = {
  agente_simples: "Agente Simples",
  agente_medio: "Agente Médio",
  agente_avancado: "Agente Avançado",
  enterprise: "Enterprise",
};
