-- manifest: **SonghaiCRM — funcionalidades por pacote.** `plans.limits.features` passa a dizer o que cada pacote inclui além do agente de IA e do WhatsApp: Simples = nada extra; Médio = agenda, CRM, qualificação de leads e relatórios; Avançado = tudo do Médio mais analytics, integrações e M-Pesa; Enterprise (sem a chave) = tudo. `features` ausente = todas, e organização sem assinatura segue sem bloqueio. Só preenche onde a chave ainda não existe (não desfaz edição do admin). Quem aplica: `requireRole`, `orgAtivaDaApi`, `resolveAuthDual`, o menu, as ferramentas do agente e `PortaDoPlano`. Bloco no `supabase/songhai.sql`.

update public.plans
   set limits = limits || jsonb_build_object('features', '[]'::jsonb)
 where slug = 'agente_simples' and not (limits ? 'features');

update public.plans
   set limits = limits || jsonb_build_object('features',
         '["agenda", "crm", "qualificacao_leads", "relatorios"]'::jsonb)
 where slug = 'agente_medio' and not (limits ? 'features');

update public.plans
   set limits = limits || jsonb_build_object('features',
         '["agenda", "crm", "qualificacao_leads", "relatorios", "analytics", "integracoes", "mpesa"]'::jsonb)
 where slug = 'agente_avancado' and not (limits ? 'features');

-- enterprise: sem a chave `features` = todas, como `max_users` ausente = sem limite.

comment on column public.plans.limits is
  'Limites e funcionalidades do pacote. max_users / max_whatsapp_connections: numéricos, ausente = sem limite. features: lista de funcionalidades além do agente e do WhatsApp (lib/plans/funcionalidades.ts); ausente = todas, [] = nenhuma.';
