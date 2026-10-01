-- =====================================================================
-- 144 LABORATÓRIO 3D — PROTEÇÃO NO SERVIDOR (acesso por perfil)
--
-- COMO USAR: Supabase > SQL Editor > New query > cole TUDO > Run.
--   * Roda numa transação só: se qualquer conferência falhar, NADA muda e
--     aparece a mensagem dizendo o porquê.
--   * Pode rodar de novo quando eu mandar versão nova (ele se atualiza).
--   * Para voltar ao que era: desfazer-protecao.sql (mesma pasta).
--   * Suba o site novo ANTES (ele funciona com e sem esta proteção).
--
-- O QUE MUDA (antes, as caixinhas de permissão só valiam na tela):
--   1. O banco confere QUEM está pedindo em toda leitura e gravação.
--      As funções originais do ERP continuam fazendo o trabalho; elas só
--      passam a ser chamadas por dentro, depois da conferência.
--   2. Vendedor recebe só o que precisa: sem os gastos (se não tiver Painel,
--      Financeiro nem Relatórios) e sem as permissões dos outros usuários.
--   3. Vendedor não cadastra produto nem muda preço, custo ou ficha técnica
--      (só o estoque muda com as vendas e a produção). Exclusão, gastos,
--      Configurações e importar backup: só ADMIN — agora conferido aqui.
--   4. Ninguém lê as tabelas direto: tudo passa pelas funções do servidor.
--      O tempo real avisa só "mudou algo" (sem dados); o site busca pela
--      função, que filtra.
--   5. Perfil: ninguém vira ADMIN sozinho; vendedor não vê e-mail dos outros;
--      o último ADMIN não pode ser rebaixado nem apagado.
--   6. Histórico no servidor: quem mudou o quê e quando (não dá pra apagar
--      pelo site; ADMIN consulta na tela Atividade).
-- Não desliga RLS de nada, não torna nada público e não usa service_role.
-- =====================================================================
begin;

create schema if not exists erp_interno;
revoke all on schema erp_interno from public;
do $$ begin
  execute 'revoke all on schema erp_interno from anon, authenticated';
exception when undefined_object then null; end $$;
alter default privileges in schema erp_interno revoke execute on functions from public;

create table if not exists erp_interno.estado_anterior (chave text primary key, valor jsonb, em timestamptz not null default now());
create table if not exists erp_interno.historico (
  id bigserial primary key,
  em timestamptz not null default now(),
  usuario uuid, nome text, perfil text,
  operacao text, colecao text, registro text,
  acao text not null, campos text[], resumo text);
create index if not exists historico_em on erp_interno.historico (em desc);
create index if not exists historico_operacao on erp_interno.historico (operacao);

-- ------------------------------------------------------------------ 1) CONFERÊNCIA
do $$
declare
  t text; c text; n_pub int; n_int int; f record; outro text;
begin
  foreach t in array array['erp_records', 'erp_deleted', 'profiles'] loop
    if to_regclass('public.' || t) is null then
      raise exception 'Não achei a tabela public.%. Este SQL é do ERP 144 Lab: confira se está no projeto certo.', t;
    end if;
    if (select relforcerowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception 'A tabela public.% está com FORCE ROW LEVEL SECURITY. Me mande isso antes de aplicar.', t;
    end if;
    if not pg_has_role(current_user, (select relowner from pg_class where oid = ('public.' || t)::regclass), 'USAGE') then
      raise exception 'O usuário atual (%) não é dono da tabela public.%. Rode pelo SQL Editor do Supabase.', current_user, t;
    end if;
  end loop;
  foreach c in array array['collection', 'id', 'data'] loop
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'erp_records' and column_name = c) then
      raise exception 'A tabela erp_records não tem a coluna "%". Me mande a estrutura dela antes de aplicar.', c;
    end if;
  end loop;
  foreach c in array array['id', 'nome', 'login', 'perfil'] loop
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = c) then
      raise exception 'A tabela profiles não tem a coluna "%".', c;
    end if;
  end loop;
  foreach t in array array['erp_changes', 'erp_commit_sync'] loop
    select count(*) into n_int from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'erp_interno' and p.proname = t;
    select count(*) into n_pub from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'public' and p.proname = t and coalesce(obj_description(p.oid, 'pg_proc'), '') not like 'erp144:%';
    if n_int > 1 then raise exception 'Há % versões de erp_interno.%.', n_int, t; end if;
    if n_int = 1 and n_pub > 0 then raise exception 'Existe public.% original E uma cópia guardada em erp_interno. Rode o desfazer-protecao.sql antes.', t; end if;
    if n_int = 0 and n_pub <> 1 then raise exception 'Esperava UMA função public.% (achei %).', t, n_pub; end if;
    -- a função original (onde estiver agora)
    select p.oid, p.proname, p.prosrc, p.proretset, p.prorettype::regtype::text as ret, coalesce(array_to_string(p.proconfig, ','), '') as cfg,
           coalesce(p.proargnames, '{}') as nomes, pg_has_role(current_user, p.proowner, 'USAGE') as dono
      into f from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where p.proname = t and ((s.nspname = 'erp_interno') or (s.nspname = 'public' and coalesce(obj_description(p.oid, 'pg_proc'), '') not like 'erp144:%'));
    if not f.dono then raise exception 'O usuário atual (%) não é dono da função %. Rode pelo SQL Editor do Supabase.', current_user, t; end if;
    if f.proretset or f.ret not in ('jsonb', 'json') then
      raise exception 'public.% devolve % (esperava jsonb). Me mande o código dela.', t, f.ret;
    end if;
    if t = 'erp_changes' and not ('since_revision' = any(f.nomes)) then raise exception 'erp_changes sem o parâmetro since_revision.'; end if;
    if t = 'erp_commit_sync' and not (array['operation_id', 'changes', 'restore'] <@ f.nomes) then raise exception 'erp_commit_sync sem operation_id/changes/restore.'; end if;
    -- se uma chama a outra com search_path próprio, a chamada cairia na função nova
    outro := case t when 'erp_changes' then 'erp_commit_sync' else 'erp_changes' end;
    if f.prosrc ~* ('\m' || outro || '\s*\(') and (f.cfg ~* 'search_path' or f.prosrc ~* ('public\.' || outro)) then
      raise exception 'A função % chama % por dentro. Me mande o código das duas antes de aplicar.', t, outro;
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------------ 2) COMO ESTAVA (para o desfazer)
insert into erp_interno.estado_anterior (chave, valor)
select 'politicas', coalesce(jsonb_agg(jsonb_build_object('tabela', tablename, 'nome', policyname, 'tipo', permissive, 'cmd', cmd,
         'papeis', roles, 'usando', qual, 'conferindo', with_check)), '[]'::jsonb)
  from pg_policies where schemaname = 'public' and tablename in ('erp_records', 'erp_deleted', 'profiles')
on conflict (chave) do nothing;
insert into erp_interno.estado_anterior (chave, valor)
select 'grants_tabelas', coalesce(jsonb_agg(jsonb_build_object('tabela', table_name, 'papel', grantee, 'privilegio', privilege_type)), '[]'::jsonb)
  from information_schema.role_table_grants
  where table_schema = 'public' and (table_name in ('erp_records', 'erp_deleted', 'profiles') or table_name like 'erp\_%') and grantee in ('anon', 'authenticated')
on conflict (chave) do nothing;
insert into erp_interno.estado_anterior (chave, valor)
select 'rls', jsonb_object_agg(relname, relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and relname in ('erp_records', 'erp_deleted', 'profiles')
on conflict (chave) do nothing;
do $$
declare f record; v jsonb := '{}';
begin
  if exists (select 1 from erp_interno.estado_anterior where chave = 'grants_funcoes') then return; end if;
  for f in select p.oid, p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname = 'public' and p.proname in ('erp_changes', 'erp_commit_sync') loop
    v := v || jsonb_build_object(f.proname, jsonb_build_object(
      'anon', has_function_privilege('anon', f.oid, 'EXECUTE'),
      'authenticated', has_function_privilege('authenticated', f.oid, 'EXECUTE')));
  end loop;
  insert into erp_interno.estado_anterior (chave, valor) values ('grants_funcoes', v);
end $$;

-- ------------------------------------------------------------------ 3) GUARDA AS FUNÇÕES ORIGINAIS
-- Vão para o esquema erp_interno (fora da API): só as funções novas chamam.
do $$
declare f record;
begin
  for f in select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname = 'public' and p.proname in ('erp_changes', 'erp_commit_sync')
             and coalesce(obj_description(p.oid, 'pg_proc'), '') not like 'erp144:%' loop
    execute format('alter function %s set schema erp_interno', f.oid::regprocedure);
  end loop;
  for f in select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname = 'erp_interno' and p.proname in ('erp_changes', 'erp_commit_sync') loop
    execute format('revoke all on function %s from public', f.oid::regprocedure);
    begin
      execute format('revoke all on function %s from anon, authenticated', f.oid::regprocedure);
    exception when undefined_object then null; end;
  end loop;
end $$;

-- chamadas às originais com os tipos exatos dos parâmetros delas
do $$
declare t_rev text; t_op text; t_ch text; t_rs text;
begin
  select format_type(p.proargtypes[array_position(p.proargnames, 'since_revision') - 1], null) into t_rev
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'erp_interno' and p.proname = 'erp_changes';
  select format_type(p.proargtypes[array_position(p.proargnames, 'operation_id') - 1], null),
         format_type(p.proargtypes[array_position(p.proargnames, 'changes') - 1], null),
         format_type(p.proargtypes[array_position(p.proargnames, 'restore') - 1], null)
    into t_op, t_ch, t_rs
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'erp_interno' and p.proname = 'erp_commit_sync';
  execute format($f$create or replace function erp_interno.chamar_changes(desde text) returns jsonb
    language sql volatile set search_path = erp_interno, public, extensions, pg_temp
    as 'select to_jsonb(erp_interno.erp_changes(since_revision => desde::%s))'$f$, t_rev);
  execute format($f$create or replace function erp_interno.chamar_commit(op text, mudancas jsonb, restaurar boolean) returns jsonb
    language sql volatile set search_path = erp_interno, public, extensions, pg_temp
    as 'select to_jsonb(erp_interno.erp_commit_sync(operation_id => op::%s, changes => mudancas::%s, restore => restaurar::%s))'$f$, t_op, t_ch, t_rs);
end $$;

-- ------------------------------------------------------------------ 4) REGRAS
-- ADMIN? (usada nas políticas; security definer para não entrar em laço no RLS de profiles)
create or replace function public.erp_eh_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and perfil = 'ADMIN')
$$;
comment on function public.erp_eh_admin() is 'erp144:protecao';
revoke all on function public.erp_eh_admin() from public;
do $$ begin execute 'revoke all on function public.erp_eh_admin() from anon'; exception when undefined_object then null; end $$;
grant execute on function public.erp_eh_admin() to authenticated;

-- permissões do vendedor, lidas das Configurações (as mesmas caixinhas da tela)
create or replace function erp_interno.permissoes_de(quem uuid) returns text[]
language sql stable set search_path = '' as $$
  select case when jsonb_typeof(p) = 'array' then array(select jsonb_array_elements_text(p))
              else array['dash', 'calc', 'quote', 'sales', 'prod', 'clients'] end   -- PERMISSOES_PADRAO do app.js
  from (select (select data -> 'permissoes' -> quem::text from public.erp_records where collection = 'config' and id = '_') as p) z
$$;

-- coleções que o vendedor não recebe
create or replace function erp_interno.ocultas(perms text[]) returns text[]
language sql immutable set search_path = '' as $$
  select case when perms && array['dash', 'fin', 'rep'] then array[]::text[] else array['expenses'] end
$$;

-- o "num()" do app.js: "1.500,50" = 1500.5; vazio = 0
create or replace function erp_interno.num(v jsonb) returns numeric
language plpgsql immutable set search_path = '' as $$
declare s text;
begin
  if v is null or jsonb_typeof(v) = 'null' then return 0; end if;
  if jsonb_typeof(v) = 'number' then return (v #>> '{}')::numeric; end if;
  if jsonb_typeof(v) <> 'string' then return 0; end if;
  s := regexp_replace(v #>> '{}', '\s', '', 'g');
  s := regexp_replace(s, '[^0-9.,-]', '', 'g');
  if position(',' in s) > 0 and position('.' in s) > 0 then s := regexp_replace(replace(s, '.', ''), ',', '.');
  elsif position(',' in s) > 0 then s := regexp_replace(s, ',', '.');
  end if;
  s := substring(s from '^-?(?:[0-9]+\.?[0-9]*|\.[0-9]+)');
  return coalesce(s::numeric, 0);
exception when others then return 0;
end $$;

-- mesmo valor para quem lê a ficha (tolera "12,50" x 12.5 e vazio x 0)
create or replace function erp_interno.mesmo_valor(a jsonb, b jsonb, tipo text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare ta text := coalesce(a #>> '{}', ''); tb text := coalesce(b #>> '{}', '');
begin
  if tipo = 'numero' then return abs(erp_interno.num(a) - erp_interno.num(b)) < 0.000001; end if;
  if tipo = 'id' then return (case when ta = '0' then '' else ta end) = (case when tb = '0' then '' else tb end); end if;
  return ta = tb;
end $$;

-- o que o vendedor recebe de um pacote (linhas e exclusões)
create or replace function erp_interno.filtrar(pacote jsonb, quem uuid, esconder text[]) returns jsonb
language plpgsql stable set search_path = '' as $$
declare linhas jsonb; apagadas jsonb;
begin
  if pacote is null then return pacote; end if;
  select coalesce(jsonb_agg(
           case when r ->> 'collection' = 'config' and jsonb_typeof(r -> 'data' -> 'permissoes') = 'object'
                then jsonb_set(r, '{data,permissoes}',
                       case when (r -> 'data' -> 'permissoes') ? quem::text
                            then jsonb_build_object(quem::text, r -> 'data' -> 'permissoes' -> quem::text) else '{}'::jsonb end)
                else r end order by i), '[]'::jsonb)
    into linhas
    from jsonb_array_elements(coalesce(pacote -> 'rows', '[]'::jsonb)) with ordinality as x(r, i)
    where not (r ->> 'collection' = any(esconder));
  select coalesce(jsonb_agg(d order by i), '[]'::jsonb) into apagadas
    from jsonb_array_elements(coalesce(pacote -> 'deleted', '[]'::jsonb)) with ordinality as x(d, i)
    where not (d ->> 'collection' = any(esconder));
  return pacote || jsonb_build_object('rows', linhas, 'deleted', apagadas);
end $$;

-- ------------------------------------------------------------------ 5) AS FUNÇÕES QUE O SITE CHAMA
-- LER: igual à original, filtrada pelo perfil. O cursor do vendedor leva as
-- regras que valeram ("123~p1"): se as caixinhas mudarem, ele recebe tudo de
-- novo (o que passou a poder ver chega, mesmo sendo antigo).
create or replace function public.erp_changes(since_revision text) returns jsonb
language plpgsql volatile security definer set search_path = erp_interno, public, extensions, pg_temp as $$
declare
  eu uuid := auth.uid(); perfil_eu text; esconder text[]; marca text;
  base text := split_part(coalesce(since_revision, '0'), '~', 1);
  veio text := split_part(coalesce(since_revision, '0'), '~', 2);
  pacote jsonb;
begin
  if eu is null then raise exception 'Entre com sua conta' using errcode = '42501'; end if;
  select perfil into perfil_eu from public.profiles where id = eu;
  if perfil_eu is null then raise exception 'Esta conta não tem perfil no sistema' using errcode = '42501'; end if;
  if base = '' then base := '0'; end if;
  -- "protegido": o site reconhece por aqui que a proteção está aplicada
  if perfil_eu = 'ADMIN' then
    return erp_interno.chamar_changes(case when veio <> '' then '0' else base end) || '{"protegido": 1}'::jsonb;
  end if;
  esconder := erp_interno.ocultas(erp_interno.permissoes_de(eu));
  marca := 'p1' || case when 'expenses' = any(esconder) then '' else 'g' end;
  pacote := erp_interno.chamar_changes(case when veio = marca then base else '0' end);
  pacote := erp_interno.filtrar(pacote, eu, esconder) || '{"protegido": 1}'::jsonb;
  if pacote ? 'cursor' then pacote := jsonb_set(pacote, '{cursor}', to_jsonb((pacote ->> 'cursor') || '~' || marca)); end if;
  return pacote;
end $$;
comment on function public.erp_changes(text) is 'erp144:protecao';

-- GRAVAR: confere o perfil, chama a original e anota no histórico
create or replace function public.erp_commit_sync(operation_id text, changes jsonb, restore boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = erp_interno, public, extensions, pg_temp as $$
declare
  eu uuid := auth.uid(); p public.profiles%rowtype; adm boolean;
  c jsonb; col text; reg text; depois jsonb; atual jsonb; k text;
  antes jsonb := '{}'; recibo jsonb;
  numericos constant text[] := array['custo', 'preco', 'gramas', 'horas', 'min', 'extras', 'margem', 'plataforma', 'qtdMesa', 'gramasUnit'];
  textos constant text[] := array['nome', 'foto', 'categoria'];
  ids constant text[] := array['printerId', 'filamentId'];
  colecoes constant text[] := array['config', 'products', 'sales', 'quotes', 'printers', 'filaments', 'clients', 'crm_logs', 'services',
                                    'expenses', 'stock_snapshots', 'prod_log', 'consignments', 'consig_history', 'est_cfg', 'meta'];
begin
  if eu is null then raise exception 'Entre com sua conta' using errcode = '42501'; end if;
  select * into p from public.profiles where id = eu;
  if p.id is null then raise exception 'Esta conta não tem perfil no sistema' using errcode = '42501'; end if;
  adm := p.perfil = 'ADMIN';
  if jsonb_typeof(changes) is distinct from 'array' then raise exception 'Lote inválido' using errcode = '22023'; end if;
  if restore and not adm then raise exception 'Importar backup requer ADMIN' using errcode = '42501'; end if;
  if not adm and jsonb_array_length(changes) > 5000 then raise exception 'Lote grande demais' using errcode = '54000'; end if;

  for c in select value from jsonb_array_elements(changes) loop
    col := c ->> 'collection'; reg := c ->> 'id';
    depois := case when jsonb_typeof(c -> 'after') in ('object', 'array') then c -> 'after' end;
    if col is null or reg is null or not (col = any(colecoes)) then raise exception 'Coleção desconhecida: %', coalesce(col, '?') using errcode = '22023'; end if;
    if length(reg) > 200 then raise exception 'Identificador grande demais' using errcode = '22023'; end if;
    if depois is not null and octet_length(depois::text) > 8 * 1024 * 1024 then raise exception 'Registro grande demais (%/%)', col, reg using errcode = '54000'; end if;
    select data into atual from public.erp_records where collection = col and id = reg;
    if not restore then antes := antes || jsonb_build_object(col || '|' || reg, coalesce(atual, 'null'::jsonb)); end if;
    if adm then continue; end if;
    if depois is null then raise exception 'Exclusão requer ADMIN' using errcode = '42501'; end if;
    if col in ('config', 'expenses') then
      raise exception '% requer ADMIN', case col when 'config' then 'Gravar Configurações' else 'Lançar ou mudar gastos' end using errcode = '42501';
    end if;
    if col = 'products' then
      if atual is null then raise exception 'Cadastrar produto requer ADMIN' using errcode = '42501'; end if;
      foreach k in array numericos loop
        if not erp_interno.mesmo_valor(atual -> k, depois -> k, 'numero') then raise exception 'Só o ADMIN muda preço, custo e ficha do produto (campo %)', k using errcode = '42501'; end if;
      end loop;
      foreach k in array textos loop
        if not erp_interno.mesmo_valor(atual -> k, depois -> k, 'texto') then raise exception 'Só o ADMIN muda preço, custo e ficha do produto (campo %)', k using errcode = '42501'; end if;
      end loop;
      foreach k in array ids loop
        if not erp_interno.mesmo_valor(atual -> k, depois -> k, 'id') then raise exception 'Só o ADMIN muda preço, custo e ficha do produto (campo %)', k using errcode = '42501'; end if;
      end loop;
    end if;
  end loop;

  recibo := erp_interno.chamar_commit(operation_id, changes, coalesce(restore, false));

  -- histórico: nunca derruba a gravação (se falhar, só avisa no log do banco)
  begin
    if not exists (select 1 from erp_interno.historico h where h.operacao = operation_id) then
      if restore then
        insert into erp_interno.historico (usuario, nome, perfil, operacao, colecao, acao, resumo)
        values (eu, p.nome, p.perfil, operation_id, '*', 'importou backup', jsonb_array_length(changes) || ' registro(s) mudaram');
      else
        insert into erp_interno.historico (usuario, nome, perfil, operacao, colecao, registro, acao, campos, resumo)
        select eu, p.nome, p.perfil, operation_id, x.value ->> 'collection', x.value ->> 'id',
               case when coalesce(jsonb_typeof(x.value -> 'after'), 'null') not in ('object', 'array') then 'apagou'
                    when a is null or a = 'null'::jsonb then 'criou' else 'alterou' end,
               case when jsonb_typeof(a) = 'object' and jsonb_typeof(x.value -> 'after') = 'object' then
                 (select array_agg(k2 order by k2) from (select k2 from jsonb_object_keys(a || (x.value -> 'after')) k2
                   where (a -> k2) is distinct from (x.value -> 'after' -> k2) limit 40) z) end,
               left(coalesce(d ->> 'nome', d ->> 'cliente', d ->> 'descricao', d ->> 'categoria', d ->> 'produto', ''), 80)
          from jsonb_array_elements(changes) x,
               lateral (select antes -> ((x.value ->> 'collection') || '|' || (x.value ->> 'id')) as a) aa,
               lateral (select case when jsonb_typeof(x.value -> 'after') = 'object' then x.value -> 'after' when jsonb_typeof(a) = 'object' then a end as d) dd;
      end if;
      if random() < 0.02 then delete from erp_interno.historico where em < now() - interval '3 years'; end if;
    end if;
  exception when others then
    raise warning 'erp144: histórico não gravado: %', sqlerrm;
  end;

  if adm then return recibo; end if;
  return erp_interno.filtrar(recibo, eu, erp_interno.ocultas(erp_interno.permissoes_de(eu)));
end $$;
comment on function public.erp_commit_sync(text, jsonb, boolean) is 'erp144:protecao';

-- quem sou eu (+ a lista de usuários, só para o ADMIN)
create or replace function public.erp_usuarios() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare eu uuid := auth.uid(); linha jsonb;
begin
  if eu is null then raise exception 'Entre com sua conta' using errcode = '42501'; end if;
  select jsonb_build_object('id', id, 'nome', nome, 'login', login, 'perfil', perfil) into linha from public.profiles where id = eu;
  if linha is null then raise exception 'Esta conta não tem perfil no sistema' using errcode = '42501'; end if;
  return jsonb_build_object('protegido', 1, 'eu', linha, 'usuarios',
    case when linha ->> 'perfil' = 'ADMIN'
         then (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'login', login, 'perfil', perfil) order by nome), '[]'::jsonb) from public.profiles)
         else jsonb_build_array(linha) end);
end $$;
comment on function public.erp_usuarios() is 'erp144:protecao';

-- histórico do servidor (só ADMIN)
create or replace function public.erp_historico(limite int default 300, antes_de bigint default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.erp_eh_admin() then raise exception 'Requer ADMIN' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(h) order by h.id desc) from (
    select id, em, nome, perfil, colecao, registro, acao, campos, resumo from erp_interno.historico
     where antes_de is null or id < antes_de order by id desc limit greatest(1, least(coalesce(limite, 300), 1000))) h), '[]'::jsonb);
end $$;
comment on function public.erp_historico(int, bigint) is 'erp144:protecao';

do $$
declare f text;
begin
  foreach f in array array['public.erp_changes(text)', 'public.erp_commit_sync(text, jsonb, boolean)', 'public.erp_usuarios()', 'public.erp_historico(int, bigint)'] loop
    execute 'revoke all on function ' || f || ' from public';
    begin execute 'revoke all on function ' || f || ' from anon'; exception when undefined_object then null; end;
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'erp_interno' loop
    execute 'revoke all on function ' || f || ' from public';
  end loop;
end $$;

-- ------------------------------------------------------------------ 6) TABELAS DO ERP: SÓ PELAS FUNÇÕES
do $$
declare t text; pol record;
begin
  foreach t in array array['erp_records', 'erp_deleted'] loop
    execute format('alter table public.%I enable row level security', t);
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;
  end loop;
  -- todas as tabelas do ERP (erp_*): visitante nada; logado só pelas funções
  for t in select tablename from pg_tables where schemaname = 'public' and tablename like 'erp\_%' loop
    begin execute format('revoke all on public.%I from anon', t); exception when undefined_object then null; end;
    begin execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', t); exception when undefined_object then null; end;
  end loop;
end $$;

-- ------------------------------------------------------------------ 7) TEMPO REAL SEM DADOS
create table if not exists public.erp_sinal (id smallint primary key default 1 check (id = 1), versao bigint not null default 0, em timestamptz not null default now());
insert into public.erp_sinal (id) values (1) on conflict (id) do nothing;
alter table public.erp_sinal enable row level security;
drop policy if exists "144: logado recebe o aviso" on public.erp_sinal;
create policy "144: logado recebe o aviso" on public.erp_sinal for select to authenticated using (auth.uid() is not null);
revoke all on public.erp_sinal from public;
do $$ begin execute 'revoke all on public.erp_sinal from anon, authenticated'; exception when undefined_object then null; end $$;
grant select on public.erp_sinal to authenticated;

create or replace function erp_interno.avisar_mudanca() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- um aviso por transação basta (o tempo real só entrega depois do commit)
  if current_setting('erp144.avisou', true) is distinct from txid_current()::text then
    perform set_config('erp144.avisou', txid_current()::text, true);
    update public.erp_sinal set versao = versao + 1, em = now() where id = 1;
  end if;
  return null;
end $$;
revoke all on function erp_interno.avisar_mudanca() from public;
drop trigger if exists erp144_aviso on public.erp_records;
drop trigger if exists erp144_aviso on public.erp_deleted;
create trigger erp144_aviso after insert or update or delete on public.erp_records for each statement execute function erp_interno.avisar_mudanca();
create trigger erp144_aviso after insert or update or delete on public.erp_deleted for each statement execute function erp_interno.avisar_mudanca();
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime' and not puballtables)
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'erp_sinal') then
    execute 'alter publication supabase_realtime add table public.erp_sinal';
  end if;
end $$;

-- ------------------------------------------------------------------ 8) PERFIS
alter table public.profiles enable row level security;
do $$
declare pol record;
begin
  for pol in select policyname from pg_policies where schemaname = 'public' and tablename = 'profiles' loop
    execute format('drop policy %I on public.profiles', pol.policyname);
  end loop;
  begin execute 'revoke all on public.profiles from anon'; exception when undefined_object then null; end;
end $$;
create policy "144: ve o proprio perfil (ADMIN ve todos)" on public.profiles for select to authenticated
  using (id = auth.uid() or public.erp_eh_admin());
create policy "144: so ADMIN cria perfil" on public.profiles for insert to authenticated with check (public.erp_eh_admin());
create policy "144: so ADMIN muda perfil" on public.profiles for update to authenticated using (public.erp_eh_admin()) with check (public.erp_eh_admin());
create policy "144: so ADMIN apaga perfil" on public.profiles for delete to authenticated using (public.erp_eh_admin());

-- trava extra (vale até para quem passa pelo RLS): ninguém se promove e o
-- último ADMIN não some. Pelo painel/SQL Editor e pela função erp-users com a
-- chave de serviço (sem usuário logado na requisição) continua livre.
create or replace function erp_interno.proteger_perfil() returns trigger
language plpgsql security definer set search_path = '' as $$
declare quem uuid := auth.uid();
begin
  if quem is not null and not public.erp_eh_admin() then
    if tg_op <> 'UPDATE' or new.perfil is distinct from old.perfil or new.id is distinct from old.id or new.login is distinct from old.login then
      raise exception 'Só o ADMIN muda perfis' using errcode = '42501';
    end if;
  end if;
  if quem is not null and tg_op in ('UPDATE', 'INSERT') and new.perfil not in ('ADMIN', 'VENDEDOR') then
    raise exception 'Perfil inválido: %', new.perfil using errcode = '22023';
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.perfil = 'ADMIN' and (tg_op = 'DELETE' or new.perfil <> 'ADMIN')
     and not exists (select 1 from public.profiles where perfil = 'ADMIN' and id <> old.id) then
    raise exception 'Não dá pra tirar o último ADMIN' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function erp_interno.proteger_perfil() from public;
drop trigger if exists erp144_proteger_perfil on public.profiles;
create trigger erp144_proteger_perfil before insert or update or delete on public.profiles for each row execute function erp_interno.proteger_perfil();

-- ------------------------------------------------------------------ 9) AUTOTESTE (como o primeiro ADMIN, só lendo)
do $$
declare adm uuid; r jsonb;
begin
  select id into adm from public.profiles where perfil = 'ADMIN' order by id limit 1;
  if adm is null then raise notice 'Sem ADMIN cadastrado: autoteste pulado.'; return; end if;
  perform set_config('request.jwt.claim.sub', adm::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', adm, 'role', 'authenticated')::text, true);
  r := public.erp_changes('0');
  if r is null or jsonb_typeof(r -> 'rows') <> 'array' or not (r ? 'cursor') then
    raise exception 'Autoteste falhou: erp_changes devolveu %', left(coalesce(r::text, 'nada'), 200);
  end if;
  r := public.erp_usuarios();
  if (r -> 'eu' ->> 'perfil') <> 'ADMIN' then raise exception 'Autoteste falhou: erp_usuarios'; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

notify pgrst, 'reload schema';
commit;

select 'PRONTO' as status, 'Proteção no servidor aplicada. Abra o ERP com um vendedor e com o ADMIN e confira que tudo funciona.' as detalhe;
