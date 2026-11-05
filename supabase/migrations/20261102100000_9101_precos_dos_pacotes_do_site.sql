-- manifest: **SonghaiCRM — preços dos pacotes alinhados com songhai.cc/precos (2026-11-02).** Agente Simples 7.000 MZN/mês, Médio 12.000, Avançado 18.000 (antes 5.000/8.000/12.000); setup 2.000/3.000/4.000 não muda; Enterprise segue sob consulta (sem preço). O site inclui 1 número de WhatsApp em todos os pacotes (números extra são complemento à parte), então `max_whatsapp_connections` passa a 1 onde ainda estava no valor de semente anterior (2 e 5). Só mexe onde o valor ainda é o da semente antiga — preço ou limite que o admin editou, ou acordado por cliente (`agreed_price_cents`), não é tocado. Bloco no `supabase/songhai.sql`.

update public.plans
   set price_cents = 700000
 where slug = 'agente_simples' and price_cents = 500000;

update public.plans
   set price_cents = 1200000
 where slug = 'agente_medio' and price_cents = 800000;

update public.plans
   set price_cents = 1800000
 where slug = 'agente_avancado' and price_cents = 1200000;

update public.plans
   set limits = jsonb_set(limits, '{max_whatsapp_connections}', '1'::jsonb)
 where slug = 'agente_medio' and (limits ->> 'max_whatsapp_connections') = '2';

update public.plans
   set limits = jsonb_set(limits, '{max_whatsapp_connections}', '1'::jsonb)
 where slug = 'agente_avancado' and (limits ->> 'max_whatsapp_connections') = '5';
