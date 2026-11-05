-- manifest: **SonghaiCRM — o valor por omissão da moeda dos planos de cobrança volta a BRL (2026-11-04).** A troca em massa BRL→MZN dos defaults tocou `cobranca_planos.moeda`, cuja constraint do upstream aceita só BRL: qualquer inserção sem moeda reprovava. O módulo `cobranca` está fora da oferta, mas o banco não pode ter um default que viola o próprio check.

do $songhai_9102$
begin
  if to_regclass('public.cobranca_planos') is not null then
    alter table public.cobranca_planos alter column moeda set default 'BRL';
  end if;
end $songhai_9102$;
