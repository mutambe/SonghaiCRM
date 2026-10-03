import { z } from "zod";
import { interfaceSettingsSchema, interfaceTemDestino } from "@/lib/navigation/interface";
import { PLANO_PADRAO, SLUGS_DE_PLANO } from "@/lib/plans/catalogo";

/** Mesmo vocabulário no formulário e no limite HTTP. */
export const tenantCreationFields = {
  display_name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/, "Apenas letras minúsculas, números e hífens"),
  legal_name: z.string().max(255).optional(),
  cnpj: z.string().max(18).optional(),
  // SonghaiCRM: o pacote do catálogo real (public.plans, migration 9004), não um rótulo.
  plan: z.enum(SLUGS_DE_PLANO),
  owner_interface_settings: interfaceSettingsSchema.optional(),
  owner_email: z.string().trim().email(),
};
export const createTenantSchema = z
  .object({ ...tenantCreationFields, plan: tenantCreationFields.plan.default(PLANO_PADRAO) })
  .refine(
    (v) => !v.owner_interface_settings || interfaceTemDestino(v.owner_interface_settings, "admin"),
    { message: "Selecione ao menos uma área de trabalho.", path: ["owner_interface_settings"] },
  );
