"use client";

/**
 * ENVIAR LOCALIZAÇÃO — SonghaiCRM (ideia trazida do OpenWA).
 *
 * A equipa cola as coordenadas ou o link do ponto no Google Maps (é o que tem
 * à mão: o pino da loja, da clínica, do armazém) e o cliente recebe o pino
 * nativo do WhatsApp, que abre no mapa do telemóvel. Link encurtado
 * (`maps.app.goo.gl`) não traz as coordenadas no texto — o aviso diz isso em
 * vez de falhar calado.
 */
import { useState } from "react";

import { useT } from "@/hooks/i18n/useT";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { coordenadasDoTexto } from "@/lib/messaging/localizacao-de-saida";
import type { Localizacao } from "@/lib/messaging/localizacao";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sending?: boolean;
  onPick: (localizacao: Localizacao) => void;
}

export function LocationPickerDialog({ open, onOpenChange, sending, onPick }: Props) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Enviar localização")}</DialogTitle>
          <DialogDescription>
            {t("Cole as coordenadas ou o link do ponto no Google Maps. O cliente recebe o pino, que abre no mapa do telemóvel.")}
          </DialogDescription>
        </DialogHeader>
        {/* O formulário vive DENTRO do conteúdo: o Radix desmonta-o ao fechar,
            e o estado recomeça vazio na próxima abertura sem efeito nenhum. */}
        <Formulario sending={sending} onCancel={() => onOpenChange(false)} onPick={onPick} />
      </DialogContent>
    </Dialog>
  );
}

function Formulario({
  sending,
  onCancel,
  onPick,
}: {
  sending?: boolean;
  onCancel: () => void;
  onPick: (localizacao: Localizacao) => void;
}) {
  const t = useT();
  const [ponto, setPonto] = useState("");
  const [nome, setNome] = useState("");
  const [endereco, setEndereco] = useState("");
  const [tocado, setTocado] = useState(false);

  const coords = coordenadasDoTexto(ponto);
  const encurtado = /goo\.gl|maps\.app/i.test(ponto);

  function enviar() {
    setTocado(true);
    if (!coords) return;
    onPick({
      ...coords,
      ...(nome.trim() ? { nome: nome.trim() } : {}),
      ...(endereco.trim() ? { endereco: endereco.trim() } : {}),
    });
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        enviar();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="localizacao-ponto">{t("Coordenadas ou link do mapa")}</Label>
        <Input
          id="localizacao-ponto"
          value={ponto}
          onChange={(e) => setPonto(e.target.value)}
          onBlur={() => setTocado(true)}
          placeholder="-25.9692, 32.5732"
          autoComplete="off"
          aria-invalid={tocado && !coords}
        />
        {tocado && !coords && (
          <p role="alert" className="text-xs text-destructive">
            {encurtado
              ? t("Link encurtado não traz as coordenadas. Abra-o no navegador e cole o endereço completo, ou as coordenadas.")
              : t("Não encontrei latitude e longitude neste texto.")}
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="localizacao-nome">{t("Nome do lugar (opcional)")}</Label>
        <Input id="localizacao-nome" value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="localizacao-endereco">{t("Endereço (opcional)")}</Label>
        <Input id="localizacao-endereco" value={endereco} maxLength={240} onChange={(e) => setEndereco(e.target.value)} />
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={sending}>
          {t("Cancelar")}
        </Button>
        <Button type="submit" disabled={sending || (tocado && !coords)}>
          {t("Enviar localização")}
        </Button>
      </DialogFooter>
    </form>
  );
}
