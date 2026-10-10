-- manifest: **SonghaiCRM — origem do agente aplicado a partir de um modelo.** `ai_agents.source_agent_id` e `source_version_id` registram de qual agente-modelo (e de qual versão publicada) um agente nasceu quando o operador aplica um modelo a um cliente (`POST /api/v1/admin/tenants/[id]/package`, Fase B da spec 19). Podem apontar para outra organização, por isso `on delete set null`: são registro de origem, nunca dependência. `provisioning_origin` não serve (CHECK fechado em dois valores sobre como a instalação provisionou). Bloco no `supabase/songhai.sql`.

alter table public.ai_agents
  add column if not exists source_agent_id uuid references public.ai_agents(id) on delete set null,
  add column if not exists source_version_id uuid references public.ai_agent_versions(id) on delete set null;

comment on column public.ai_agents.source_agent_id is
  'Agente-modelo de que este nasceu (aplicar modelo a um cliente). Nulo = criado na própria organização. Pode apontar para OUTRA organização: é só o registro de origem, nunca uma dependência — apagar o modelo zera o ponteiro.';
comment on column public.ai_agents.source_version_id is
  'Versão publicada do modelo que foi copiada. Mesma regra de source_agent_id.';
