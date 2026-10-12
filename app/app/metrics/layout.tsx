import { PortaDoPlano } from "@/components/plano/PortaDoPlano";

/** Esta secção depende do pacote da organização: ver `components/plano/PortaDoPlano.tsx`. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <PortaDoPlano funcionalidade="analytics">{children}</PortaDoPlano>;
}
