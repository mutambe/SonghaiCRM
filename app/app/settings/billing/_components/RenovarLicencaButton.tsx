"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { renovarLicenca } from "@/app/actions/licensing/renovar";

export function RenovarLicencaButton() {
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setErro(null);
            const r = await renovarLicenca();
            if ("error" in r) {
              setErro(r.error);
              return;
            }
            window.open(r.checkoutUrl, "_blank", "noopener,noreferrer");
          })
        }
      >
        {pending ? "Gerando cobrança…" : "Renovar agora"}
      </Button>
      {erro ? <p className="text-sm text-destructive">{erro}</p> : null}
    </div>
  );
}
