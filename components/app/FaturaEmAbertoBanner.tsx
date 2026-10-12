/**
 * O AVISO DA FACTURA — no topo de toda tela de /app, para quem administra a
 * empresa (SonghaiCRM, 9010). Aparece 5 dias antes do vencimento e fica até ser
 * paga; depois de vencida diz a data exacta em que a conta será suspensa.
 *
 * Componente de apresentação: o texto chega pronto (traduzido e formatado) do
 * layout, que é servidor. Não pergunta nada a ninguém.
 */
import Link from "next/link";

export function FaturaEmAbertoBanner({
  texto,
  acao,
  href,
  urgente,
  testId = "fatura-em-aberto",
}: {
  texto: string;
  acao: string;
  href: string;
  urgente: boolean;
  /** O mesmo aviso serve ao consumo de tokens (`tokens-de-ia`). */
  testId?: string;
}) {
  return (
    <div
      role="status"
      data-testid={testId}
      className={
        urgente
          ? "flex flex-wrap items-center justify-between gap-3 border-b border-error-fg/30 bg-error-fg/10 px-4 py-2 text-sm text-error-fg"
          : "flex flex-wrap items-center justify-between gap-3 border-b bg-muted px-4 py-2 text-sm"
      }
    >
      <span>{texto}</span>
      <Link href={href} className="font-medium underline underline-offset-4">
        {acao}
      </Link>
    </div>
  );
}
