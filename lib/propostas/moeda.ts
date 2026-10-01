// lib/propostas/moeda.ts
export function formatarMoeda(cents: number, iso: string): string {
  return (cents / 100).toLocaleString("pt-MZ", { style: "currency", currency: iso });
}
