/**
 * Editar e apagar uma organização pelo painel da plataforma — SonghaiCRM
 * (porte do `b1b1eb812` do fork). As regras puras moram aqui; a rota
 * (`app/api/v1/admin/tenants/[id]/route.ts`) só autoriza, lê e escreve.
 */
import { z } from "zod";

import { isValidNuit } from "@/lib/legal/perfil-do-pais";
import { tenantCreationFields } from "@/lib/schemas/tenant-creation";

/**
 * O NUIT entra como `nuit` e é gravado na coluna `cnpj` do upstream — a mesma
 * que o formulário de criação preenche e que a ficha mostra com o rótulo NUIT.
 * Renomear a coluna brigaria com cada `git merge upstream/main`.
 * `null` ou vazio apaga; o resto passa por `isValidNuit` (9 dígitos) e é
 * gravado só com os dígitos.
 */
export const edicaoDaOrganizacaoSchema = z
  .object({
    display_name: tenantCreationFields.display_name.optional(),
    legal_name: z.string().trim().min(2).max(255).optional(),
    slug: tenantCreationFields.slug.optional(),
    nuit: z
      .string()
      .trim()
      .max(20)
      .nullable()
      .optional()
      .refine((v) => v === undefined || v === null || v === "" || isValidNuit(v), {
        message: "NUIT inválido (9 dígitos)",
      }),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Informe ao menos um campo." });

export type EdicaoDaOrganizacao = z.infer<typeof edicaoDaOrganizacaoSchema>;

/** O pedido validado vira as colunas reais de `organizations`. */
export function colunasDaEdicao(e: EdicaoDaOrganizacao): Record<string, string | null> {
  const colunas: Record<string, string | null> = {};
  if (e.display_name !== undefined) colunas.display_name = e.display_name;
  if (e.legal_name !== undefined) colunas.legal_name = e.legal_name;
  if (e.slug !== undefined) colunas.slug = e.slug;
  if (e.nuit !== undefined) colunas.cnpj = e.nuit ? e.nuit.replace(/\D/g, "") : null;
  return colunas;
}

export interface UsoDaOrganizacao {
  membros_ativos: number;
  conversas: number;
  mensagens: number;
  negocios: number;
  pedidos: number;
  canais: number;
}

/**
 * Apagar é para a organização criada por engano (nome, slug ou e-mail errados)
 * e nunca usada. Qualquer uso real — alguém que entrou, uma conversa, um
 * negócio, um canal ligado — e a resposta é SUSPENDER, que preserva tudo.
 * `membros_ativos` não conta o vínculo provisório de quem a criou.
 */
export function organizacaoTemUso(uso: UsoDaOrganizacao): boolean {
  return Object.values(uso).some((n) => n > 0);
}
