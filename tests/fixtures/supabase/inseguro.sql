-- Projeto com os erros que a auditoria tem que achar.
create table public.erp_records(id text primary key, dados jsonb, revision bigint);
create table public.erp_deleted(id text primary key, revision bigint);
alter table public.erp_deleted enable row level security;
create policy "tudo" on public.erp_deleted for all to public using (true) with check (true);
create table public.profiles(id uuid primary key, nome text, login text, perfil text);
alter table public.profiles enable row level security;
create policy "le" on public.profiles for select to authenticated using (true);
create policy "edita o proprio" on public.profiles for update to authenticated using (id = auth.uid());
create function public.erp_commit_sync(operation_id text, changes jsonb, restore boolean) returns jsonb language plpgsql security definer as $$
begin if restore then delete from public.erp_records; end if; execute 'insert into public.erp_records select ' || changes::text; return '{}'; end $$;
create function public.erp_changes(since_revision bigint) returns jsonb language plpgsql security definer as $$
begin if auth.uid() is null then raise exception 'login'; end if; return '{}'; end $$;
insert into storage.buckets(id, name, public) values ('fotos', 'fotos', true);
create view public.resumo as select count(*) from public.erp_records;
alter publication supabase_realtime add table public.erp_records, public.erp_deleted;
insert into auth.users(id, email, email_confirmed_at) values ('00000000-0000-0000-0000-000000000001','dono@x.com',now()),('00000000-0000-0000-0000-000000000002','vend@x.com',now()),('00000000-0000-0000-0000-000000000003','estranho@x.com',null);
insert into public.profiles values ('00000000-0000-0000-0000-000000000001','Dono','dono@x.com','ADMIN'),('00000000-0000-0000-0000-000000000002','Vend','vend@x.com','VENDEDOR');
