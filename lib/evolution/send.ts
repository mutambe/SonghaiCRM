/**
 * Endereço Evolution API de uma conversa — mirror de `lib/waha/send.ts`, sem
 * a complexidade de LID (fora de escopo da v1, ver spec).
 */
export interface ResolveEvolutionChatIdInput {
  isGroup: boolean;
  groupChatId: string | null;
  phoneNumber: string | null | undefined;
}

export function resolveEvolutionChatId(input: ResolveEvolutionChatIdInput): string | null {
  if (input.isGroup && input.groupChatId) return input.groupChatId;
  if (input.phoneNumber) return `${input.phoneNumber.replace(/\D/g, "")}@s.whatsapp.net`;
  return null;
}
