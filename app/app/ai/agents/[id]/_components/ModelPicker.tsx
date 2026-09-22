"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PROVEDORES } from "@/lib/ai/pontos/provedores";

/**
 * Derivado de `lib/ai/pontos/provedores.ts` — a mesma lista única da tela de
 * Credenciais e da rota. Como literal aqui, o seletor de modelo do agente não
 * conseguia representar um agente publicado em OpenRouter.
 */
export type Provider = (typeof PROVEDORES)[number]["id"];

export interface ModelOption {
  provider: Provider;
  model_id: string;
  display_name: string;
  context_window: number | null;
  is_default_for_provider: boolean;
}

interface Props {
  provider: Provider;
  value: string;
  onChange: (modelId: string, ctx?: { contextWindow: number | null }) => void;
  disabled?: boolean;
  id?: string;
  /**
   * Texto do estado "nada escolhido". Existe porque nem todo uso deste seletor
   * trata vazio como erro: no papel Operador, vazio SIGNIFICA "usa o mesmo
   * modelo que conversa", e chamar isso de "Selecione um modelo" mentiria.
   */
  placeholder?: string;
  /**
   * SÓ para o 9Router (`AgentForm` só passa isto quando `provider === "9router"`).
   * Cada instância de 9Router é do operador — não há como curar um catálogo
   * global do que ele configurou lá, e é por isso que o dropdown ficava
   * eternamente vazio. Em vez disso usa o que a validação da credencial já
   * descobriu (`ai_provider_credentials.models_available`, populado em
   * `lib/ai/credenciais/guardar.ts` no mesmo `GET /models` que confirma a
   * chave). `undefined` = comportamento de sempre (catálogo global
   * `ai_models`); array (mesmo vazio) = troca de fonte.
   */
  credentialModels?: string[] | null;
}

interface ApiResponse {
  data: { models: ModelOption[] };
}

export function ModelPicker({
  provider,
  value,
  onChange,
  disabled,
  id,
  placeholder,
  credentialModels,
}: Props) {
  const usaCredencial = credentialModels !== undefined;

  const query = useQuery({
    queryKey: ["ai", "providers", provider, "models"],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse>(`/api/v1/ai/providers/${provider}/models`);
      return res.data.models;
    },
    staleTime: 60_000,
    enabled: !usaCredencial,
  });

  const models: ModelOption[] = usaCredencial
    ? (credentialModels ?? []).map((modelId) => ({
        provider,
        model_id: modelId,
        display_name: modelId,
        context_window: null,
        is_default_for_provider: false,
      }))
    : (query.data ?? []);

  const carregando = !usaCredencial && query.isLoading;

  // No modo credencial, vazio tem dois motivos distintos — e confundi-los faz
  // o operador procurar bug numa chave que só ainda não foi escolhida.
  const semOpcaoTexto = usaCredencial
    ? credentialModels === null
      ? "Escolha a chave de acesso primeiro"
      : "Nenhum modelo encontrado nesta chave"
    : "Nenhum modelo disponível";

  return (
    <div className="space-y-1">
      <Label htmlFor={id}>Modelo</Label>
      <Select
        value={value || undefined}
        onValueChange={(v) => {
          const m = models.find((m) => m.model_id === v);
          onChange(v, { contextWindow: m?.context_window ?? null });
        }}
        disabled={disabled || carregando}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder={carregando ? "Carregando…" : (placeholder ?? "Selecione um modelo")} />
        </SelectTrigger>
        <SelectContent>
          {models.map((m) => (
            <SelectItem key={m.model_id} value={m.model_id}>
              {m.display_name}
              {m.is_default_for_provider ? " · default" : ""}
            </SelectItem>
          ))}
          {models.length === 0 && !carregando ? (
            <SelectItem value="__none__" disabled>
              {semOpcaoTexto}
            </SelectItem>
          ) : null}
        </SelectContent>
      </Select>
    </div>
  );
}

export function useModelMeta(provider: Provider, modelId: string): ModelOption | null {
  const query = useQuery({
    queryKey: ["ai", "providers", provider, "models"],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse>(`/api/v1/ai/providers/${provider}/models`);
      return res.data.models;
    },
    staleTime: 60_000,
  });
  return (query.data ?? []).find((m) => m.model_id === modelId) ?? null;
}
