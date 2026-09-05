/**
 * Chave pública Ed25519 que verifica os tokens de licença assinados pela
 * instância central. Embutida na imagem Docker (não é `.env`) — trocar de
 * chave exige nova imagem publicada, deliberado: só a Songhai controla o
 * par. A privada correspondente vive só em `LICENSING_SIGNING_PRIVATE_KEY`
 * no `.env` da instância central, nunca commitada.
 */
export const LICENSING_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA6OJL5lD8r26ySKQ8nVQqX+H+KojHcfm8HvN6aRN7ovw=
-----END PUBLIC KEY-----
`;
