/**
 * SonghaiCRM — O LOGO TEM FUNDO TRANSPARENTE?
 *
 * O defeito, medido numa instalação real (2026-10-03): o dono enviou como "logo
 * para o tema escuro" um PNG que ELE achava transparente — e que tinha o fundo
 * pintado de RGB(33,27,21), sem um único pixel transparente. No login, onde o
 * fundo da página é quase da mesma cor, o retângulo quase sumia; na barra
 * lateral, que é de outro tom, aparecia uma caixa escura em volta do logo. O
 * produto mostrava o arquivo fielmente, e ninguém dizia à pessoa porquê.
 *
 * Esta função responde à pergunta no NAVEGADOR, no momento do upload, com o
 * mesmo decodificador que vai exibir a imagem (como `lona-do-navegador.ts`): o
 * servidor continua só farejando a assinatura do arquivo.
 *
 * - `true`  : há pelo menos um pixel com alfa < 255 — o fundo pode sumir;
 * - `false` : nenhum pixel transparente (todo JPEG, e PNG exportado com fundo);
 * - `null`  : não deu para medir (sem canvas no ambiente). Sem medida, sem aviso:
 *             avisar errado ensina a pessoa a ignorar avisos.
 */

/** Varre os pixels e diz se algum não é totalmente opaco. Pura, para teste. */
export function haPixelTransparente(rgba: ArrayLike<number>): boolean {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i]! < 255) return true;
  return false;
}

export async function logoTemTransparencia(arquivo: File): Promise<boolean | null> {
  // JPEG não tem canal alfa: a resposta vem do formato, sem decodificar.
  if (arquivo.type === "image/jpeg") return false;
  try {
    if (typeof createImageBitmap !== "function") return null;
    const bitmap = await createImageBitmap(arquivo);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0);
      return haPixelTransparente(ctx.getImageData(0, 0, bitmap.width, bitmap.height).data);
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}
