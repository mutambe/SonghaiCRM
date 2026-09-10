"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";

export interface Plan {
  id: string;
  slug: string;
  display_name: string;
  price_cents: number | null;
  setup_fee_cents: number | null;
  currency: string;
}

export interface PlansResponse {
  data: Plan[];
}

export function usePlans() {
  return useQuery({
    queryKey: ["plans"] as const,
    queryFn: () => apiClient.get<PlansResponse>("/api/v1/plans"),
    staleTime: 5 * 60_000,
  });
}
