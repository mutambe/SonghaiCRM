/**
 * Chave pública Ed25519 que verifica os tokens de licença assinados pela
 * instância central. Embutida na imagem Docker (não é `.env`) — trocar de
 * chave exige nova imagem publicada, deliberado: só a Songhai controla o
 * par. A privada correspondente vive só em `LICENSING_SIGNING_PRIVATE_KEY`
 * no `.env` da instância central, nunca commitada.
 */
import { env } from "@/lib/env";

export const LICENSING_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA6OJL5lD8r26ySKQ8nVQqX+H+KojHcfm8HvN6aRN7ovw=
-----END PUBLIC KEY-----
`;

/**
 * A chave pública EFETIVA — normalmente a constante acima. A suíte e2e
 * (`scripts/seed-e2e-licensing.ts`) sobrescreve via
 * `LICENSING_PUBLIC_KEY_PEM_TEST_OVERRIDE` pra poder assinar um token de
 * teste com um par Ed25519 efêmero gerado no próprio job de CI, sem nunca
 * tocar a chave privada real da Central (que nunca sai do `.env` dela).
 *
 * Um clone de produção nunca define essa var — não é isso que se documenta
 * em `.env.example`/no kit de instalação — e mesmo que alguém a defina no
 * próprio servidor, isso não abre superfície nova: quem já tem acesso de
 * root pra editar `.env` também tem acesso pra editar o arquivo compilado
 * que contém `LICENSING_PUBLIC_KEY_PEM` acima.
 */
export function resolvePublicKeyPem(): string {
  return env.LICENSING_PUBLIC_KEY_PEM_TEST_OVERRIDE || LICENSING_PUBLIC_KEY_PEM;
}
