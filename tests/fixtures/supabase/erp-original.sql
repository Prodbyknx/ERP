-- Imitação do banco do ERP como está hoje no Supabase (o que o cloud.js e o
-- Supabase falso dos testes mostram): erp_records/erp_deleted com revisão,
-- erp_changes (delta desde uma revisão) e erp_commit_sync (lote atômico com
-- conferência do "antes"), e as regras que a tela de Usuários descreve:
-- vendedor não exclui, não grava gastos nem Configurações; importar backup só
-- ADMIN. E as brechas que o sistema original deixa: qualquer logado lê TUDO
-- (direto na tabela e pela função) e pode editar o próprio perfil.
-- Roda depois de base.sql. Usado por tests/protecao-servidor.test.mjs.
create table public.profiles(id uuid primary key, nome text, login text, perfil text not null default 'VENDEDOR', criado_em timestamptz default now());
create table public.erp_records(
  collection text not null, id text not null, data jsonb not null,
  sync_revision bigint not null, insertion_order bigint not null,
  updated_by uuid, updated_at timestamptz not null default now(),
  primary key (collection, id));
create table public.erp_deleted(collection text not null, id text not null, sync_revision bigint not null, primary key (collection, id));
create table public.erp_operations(operation_id uuid primary key, actor uuid, receipt jsonb not null, created_at timestamptz default now());
create sequence public.erp_revision_seq;
create sequence public.erp_order_seq;
alter table public.profiles enable row level security;
alter table public.erp_records enable row level security;
alter table public.erp_deleted enable row level security;
alter table public.erp_operations enable row level security;
create policy "logado le registros" on public.erp_records for select to authenticated using (auth.uid() is not null);
create policy "logado le exclusoes" on public.erp_deleted for select to authenticated using (auth.uid() is not null);
create policy "logado le perfis" on public.profiles for select to authenticated using (auth.uid() is not null);
create policy "edita o proprio perfil" on public.profiles for update to authenticated using (id = auth.uid());

create function public.erp_changes(since_revision bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare atual bigint;
begin
  if auth.uid() is null then raise exception 'Entre com sua conta' using errcode = '42501'; end if;
  select coalesce(max(r), 0) into atual from (select max(sync_revision) r from erp_records union all select max(sync_revision) from erp_deleted) z;
  return jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object('collection', collection, 'id', id, 'data', data, 'sync_revision', sync_revision, 'insertion_order', insertion_order) order by sync_revision)
                      from erp_records where sync_revision > since_revision), '[]'::jsonb),
    'deleted', coalesce((select jsonb_agg(jsonb_build_object('collection', collection, 'id', id, 'sync_revision', sync_revision) order by sync_revision)
                      from erp_deleted where sync_revision > since_revision), '[]'::jsonb),
    'cursor', atual::text,
    'reset_required', since_revision > atual);
end $$;

create function public.erp_commit_sync(operation_id uuid, changes jsonb, restore boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  eu uuid := auth.uid(); adm boolean; c jsonb; atual jsonb; rev bigint; ordem bigint;
  linhas jsonb := '[]'; apagadas jsonb := '[]'; recibo jsonb;
begin
  if eu is null then raise exception 'Entre com sua conta' using errcode = '42501'; end if;
  select perfil = 'ADMIN' into adm from profiles where id = eu;
  if adm is null then raise exception 'Conta sem perfil' using errcode = '42501'; end if;
  select receipt into recibo from erp_operations o where o.operation_id = erp_commit_sync.operation_id;
  if recibo is not null then return recibo; end if;
  if restore and not adm then raise exception 'Requer ADMIN' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(144);
  for c in select value from jsonb_array_elements(changes) loop
    if not adm and ((c->'after') is null or c->'after' = 'null'::jsonb) then raise exception 'Exclusão requer ADMIN' using errcode = '42501'; end if;
    if not adm and c->>'collection' in ('config', 'expenses') then raise exception 'Requer ADMIN' using errcode = '42501'; end if;
    select data into atual from erp_records where collection = c->>'collection' and id = c->>'id';
    if atual is distinct from (case when c->'before' = 'null'::jsonb then null else c->'before' end) then
      raise exception 'Conflito em %/%: o registro mudou em outro computador', c->>'collection', c->>'id' using errcode = '40001';
    end if;
    rev := nextval('erp_revision_seq');
    if (c->'after') is null or c->'after' = 'null'::jsonb then
      delete from erp_records where collection = c->>'collection' and id = c->>'id';
      insert into erp_deleted values (c->>'collection', c->>'id', rev) on conflict (collection, id) do update set sync_revision = excluded.sync_revision;
      apagadas := apagadas || jsonb_build_object('collection', c->>'collection', 'id', c->>'id', 'sync_revision', rev);
    else
      select insertion_order into ordem from erp_records where collection = c->>'collection' and id = c->>'id';
      ordem := coalesce(ordem, nextval('erp_order_seq'));
      insert into erp_records values (c->>'collection', c->>'id', c->'after', rev, ordem, eu, now())
        on conflict (collection, id) do update set data = excluded.data, sync_revision = excluded.sync_revision, updated_by = excluded.updated_by, updated_at = now();
      delete from erp_deleted where collection = c->>'collection' and id = c->>'id';
      linhas := linhas || jsonb_build_object('collection', c->>'collection', 'id', c->>'id', 'data', c->'after', 'sync_revision', rev, 'insertion_order', ordem);
    end if;
  end loop;
  recibo := jsonb_build_object('rows', linhas, 'deleted', apagadas, 'cursor', (select last_value from erp_revision_seq)::text);
  insert into erp_operations values (erp_commit_sync.operation_id, eu, recibo);
  return recibo;
end $$;
revoke execute on function public.erp_changes(bigint), public.erp_commit_sync(uuid, jsonb, boolean) from public, anon;
grant execute on function public.erp_changes(bigint), public.erp_commit_sync(uuid, jsonb, boolean) to authenticated;
alter publication supabase_realtime add table public.erp_records, public.erp_deleted;
