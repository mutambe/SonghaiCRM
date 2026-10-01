/**
 * OS PROVIDERS QUE SÃO UM NÚMERO DE WHATSAPP DE CONVERSA — SonghaiCRM.
 *
 * É o que o teto do pacote conta (`lib/plans/teto-de-conexoes.ts`, migration
 * 0504): quantos números a organização tem ligados. Mora aqui, e não no plano,
 * porque nomear provider fora de `lib/channels/` é proibido
 * (`docs/doctrine/restricao-de-canal.md`, invariante 1; `pnpm lint:channels`).
 *
 * Deriva da lista de canais de mensagem e tira o que conversa mas NÃO é número
 * de WhatsApp: Instagram/Messenger (`zernio_social`). A voz (`wacalls`) já não
 * está na lista de origem. Provider de mensagem novo entra aqui sozinho — e
 * conta no teto — a menos que alguém decida o contrário nesta linha.
 */
import { PROVIDERS_DE_MENSAGEM } from "./capabilities";

const NAO_SAO_NUMERO_DE_WHATSAPP = ["zernio_social"] as const;

export const PROVIDERS_DE_NUMERO_WHATSAPP = PROVIDERS_DE_MENSAGEM.filter(
  (p) => !(NAO_SAO_NUMERO_DE_WHATSAPP as readonly string[]).includes(p),
);
