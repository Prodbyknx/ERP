-- =====================================================================
-- 144 LABORATÓRIO 3D — DESFAZER A PROTEÇÃO NO SERVIDOR
-- Volta o banco a como estava antes do protecao-servidor.sql: as funções
-- originais voltam para o lugar, as políticas e permissões antigas também.
-- Supabase > SQL Editor > New query > cole TUDO > Run. Uma transação só.
-- Atenção: o histórico do servidor (quem mudou o quê) é apagado junto.
-- =====================================================================
begin;

do $$
begin
  if to_regclass('erp_interno.estado_anterior') is null then
    raise exception 'A proteção não está aplicada (não achei erp_interno.estado_anterior). Nada a desfazer.';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'erp_interno' and p.proname = 'erp_changes')
     or not exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'erp_interno' and p.proname = 'erp_commit_sync') then
    raise exception 'As funções originais não estão em erp_interno. Me mande o resultado de: select proname, pronamespace::regnamespace from pg_proc where proname like ''erp_%%'';';
  end if;
end $$;

-- 1) tira o que a proteção criou
drop trigger if exists erp144_aviso on public.erp_records;
drop trigger if exists erp144_aviso on public.erp_deleted;
drop trigger if exists erp144_proteger_perfil on public.profiles;
drop function if exists public.erp_changes(text);
drop function if exists public.erp_commit_sync(text, jsonb, boolean);
drop function if exists public.erp_usuarios();
drop function if exists public.erp_historico(int, bigint);
drop table if exists public.erp_sinal;

-- 2) funções originais de volta, com as permissões de antes
do $$
declare f record; g jsonb := (select valor from erp_interno.estado_anterior where chave = 'grants_funcoes');
begin
  for f in select p.oid, p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname = 'erp_interno' and p.proname in ('erp_changes', 'erp_commit_sync') loop
    execute format('alter function %s set schema public', f.oid::regprocedure);
    if coalesce((g -> f.proname ->> 'authenticated')::boolean, true) then execute format('grant execute on function %s to authenticated', f.oid::regprocedure); end if;
    if coalesce((g -> f.proname ->> 'anon')::boolean, false) then execute format('grant execute on function %s to anon', f.oid::regprocedure); end if;
  end loop;
end $$;

-- 3) políticas, permissões de tabela e RLS de antes
do $$
declare t text; pol record; p jsonb; g jsonb; rls jsonb := (select valor from erp_interno.estado_anterior where chave = 'rls');
begin
  foreach t in array array['erp_records', 'erp_deleted', 'profiles'] loop
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;
  end loop;
  for p in select jsonb_array_elements(valor) from erp_interno.estado_anterior where chave = 'politicas' loop
    execute format('create policy %I on public.%I as %s for %s to %s%s%s',
      p ->> 'nome', p ->> 'tabela', p ->> 'tipo', p ->> 'cmd',
      (select string_agg(case when r = 'public' then 'public' else quote_ident(r) end, ', ') from jsonb_array_elements_text(p -> 'papeis') r),
      case when p ->> 'usando' is not null then ' using (' || (p ->> 'usando') || ')' else '' end,
      case when p ->> 'conferindo' is not null then ' with check (' || (p ->> 'conferindo') || ')' else '' end);
  end loop;
  for g in select jsonb_array_elements(valor) from erp_interno.estado_anterior where chave = 'grants_tabelas' loop
    begin
      execute format('grant %s on public.%I to %I', g ->> 'privilegio', g ->> 'tabela', g ->> 'papel');
    exception when undefined_table then null; end;
  end loop;
  -- o RLS só é desligado se estava desligado antes (a proteção nunca desliga)
  foreach t in array array['erp_records', 'erp_deleted', 'profiles'] loop
    if rls ? t and not (rls ->> t)::boolean then execute format('alter table public.%I disable row level security', t); end if;
  end loop;
end $$;

drop function if exists public.erp_eh_admin();
drop schema erp_interno cascade;

notify pgrst, 'reload schema';
commit;

select 'DESFEITO' as status, 'O banco voltou a como estava antes da proteção.' as detalhe;
