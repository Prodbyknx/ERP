-- Projeto configurado do jeito certo: a auditoria não pode apontar falha.
create table public.erp_records(id text primary key, dados jsonb, revision bigint);
create table public.erp_deleted(id text primary key, revision bigint);
create table public.profiles(id uuid primary key, nome text, login text, perfil text);
alter table public.erp_records enable row level security;
alter table public.erp_deleted enable row level security;
alter table public.profiles enable row level security;
create policy "logado le" on public.erp_records for select to authenticated using (auth.uid() is not null);
create policy "logado le" on public.erp_deleted for select to authenticated using (auth.uid() is not null);
create policy "logado le" on public.profiles for select to authenticated using (auth.uid() is not null);
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
create function public.erp_commit_sync(operation_id text, changes jsonb, restore boolean) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'login'; end if;
  if restore and not exists (select 1 from public.profiles where id = auth.uid() and perfil = 'ADMIN') then raise exception 'Requer ADMIN'; end if;
  return '{}';
end $$;
create function public.erp_changes(since_revision bigint) returns jsonb language plpgsql security definer set search_path = '' as $$
begin if auth.uid() is null then raise exception 'login'; end if; return '{}'; end $$;
revoke execute on function public.erp_commit_sync(text, jsonb, boolean), public.erp_changes(bigint) from anon, public;
create view public.resumo with (security_invoker = true) as select count(*) from public.erp_records;
revoke all on public.resumo from anon;
alter publication supabase_realtime add table public.erp_records, public.erp_deleted;
insert into auth.users(id, email, email_confirmed_at) values ('00000000-0000-0000-0000-000000000001','dono@x.com',now()),('00000000-0000-0000-0000-000000000002','vend@x.com',now());
insert into public.profiles values ('00000000-0000-0000-0000-000000000001','Dono','dono@x.com','ADMIN'),('00000000-0000-0000-0000-000000000002','Vend','vend@x.com','VENDEDOR');
