-- =====================================================================
-- 144 LABORATÓRIO 3D — AUDITORIA DE SEGURANÇA DO SUPABASE (SÓ LEITURA)
-- Como usar: Supabase > SQL Editor > New query > cole TUDO > Run.
-- Não altera nada: só lê o catálogo do banco. Resultado: uma tabela com
-- FALHA (corrigir antes de lançar), ATENÇÃO (conferir), INFO e OK.
-- =====================================================================
with
tabelas as (
  select c.oid, c.relname as tabela, c.relrowsecurity as rls,
         (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as politicas
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
),
politicas as (
  select tablename, policyname, cmd, roles,
         coalesce(qual, '') as qual, coalesce(with_check, '') as chk,
         (roles && array['anon', 'public']::name[]) as para_todos
  from pg_policies where schemaname = 'public'
),
funcoes as (
  select p.oid, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as nome,
         p.prosecdef as definer, coalesce(array_to_string(p.proconfig, ','), '') as cfg,
         has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
         lower(p.prosrc) as src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')  -- ignora funções de extensões
),
-- quem pode gravar a coluna perfil (vira ADMIN?)
perfil as (
  select
    to_regclass('public.profiles') is not null as existe,
    exists (select 1 from information_schema.column_privileges
            where table_schema = 'public' and table_name = 'profiles' and column_name = 'perfil'
              and grantee in ('authenticated', 'anon', 'PUBLIC') and privilege_type in ('UPDATE', 'INSERT')) as coluna_gravavel,
    (select string_agg(policyname || ' [' || cmd || ']: ' || qual || case when chk <> '' then ' / check: ' || chk else '' end, ' | ')
       from politicas where tablename = 'profiles' and cmd in ('UPDATE', 'INSERT', 'ALL')
         and (roles && array['authenticated', 'anon', 'public']::name[])) as politicas_gravar,
    (select string_agg(t.tgname, ', ') from pg_trigger t
       where t.tgrelid = to_regclass('public.profiles') and not t.tgisinternal) as gatilhos
),
resultado as (
  -- 1) RLS em toda tabela (item 4)
  select 1 as ordem, 'RLS (item 4)' as item, t.tabela as objeto,
         case when not t.rls then 'FALHA' when t.politicas = 0 then 'INFO' else 'OK' end as status,
         case when not t.rls then 'RLS DESLIGADO: quem tem a chave pública do site lê e grava esta tabela. Corrija: alter table public.' || t.tabela || ' enable row level security;'
              when t.politicas = 0 then 'RLS ligado e sem política: só funções do servidor (security definer) acessam.'
              else 'RLS ligado com ' || t.politicas || ' política(s).' end as detalhe
  from tabelas t

  union all
  -- 2) políticas abertas (item 4/7)
  select 2, 'Política (item 4/7)', p.tablename || ' / ' || p.policyname,
         case when p.para_todos and (p.qual in ('true', '') and p.chk in ('true', '')) then 'FALHA'
              when p.para_todos and (p.qual || p.chk) !~* 'auth\.(uid|jwt|role)\(' then 'ATENÇÃO'
              when (p.qual in ('true', '') and p.chk in ('true', '')) then 'INFO'
              else 'OK' end,
         case when p.para_todos and (p.qual in ('true', '') and p.chk in ('true', '')) then 'Libera ' || p.cmd || ' para QUALQUER PESSOA (anon/public), sem login.'
              when p.para_todos and (p.qual || p.chk) !~* 'auth\.(uid|jwt|role)\(' then 'Vale para anon/public e não confere o usuário logado: ' || p.qual || ' ' || p.chk
              when (p.qual in ('true', '') and p.chk in ('true', '')) then 'Qualquer usuário LOGADO (' || array_to_string(p.roles, ',') || ') faz ' || p.cmd || '. Seguro só se o cadastro público estiver desligado.'
              else p.cmd || ' para ' || array_to_string(p.roles, ',') || ' com regra: ' || p.qual || case when p.chk <> '' then ' / ' || p.chk else '' end end
  from politicas p

  union all
  -- 3) visitante (anon) com permissão de gravar tabela (item 7)
  select 3, 'Permissão do visitante (item 7)', g.table_name,
         case when t.rls then 'ATENÇÃO' else 'FALHA' end,
         'anon (sem login) tem ' || string_agg(g.privilege_type, ', ' order by g.privilege_type) ||
         case when t.rls then '. O RLS segura, mas o certo é tirar: revoke insert, update, delete, truncate on public.' || g.table_name || ' from anon;'
              else ' e a tabela está SEM RLS.' end
  from information_schema.role_table_grants g
  join tabelas t on t.tabela = g.table_name
  where g.table_schema = 'public' and g.grantee = 'anon' and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
  group by g.table_name, t.rls

  union all
  -- 4) funções chamáveis pelo site (item 6/7/13)
  select 4, 'Função (item 6/7/13)', f.nome,
         case when f.anon and f.definer and f.src !~ 'auth\.(uid|jwt|role)\(' then 'FALHA'
              when f.src ~ 'restore' and f.src !~ 'admin' then 'FALHA'
              when f.definer and f.cfg !~* 'search_path' then 'ATENÇÃO'
              when f.src ~ 'execute\s' and f.src ~ '(\|\||format\s*\()' then 'ATENÇÃO'
              when f.anon then 'ATENÇÃO'
              else 'OK' end,
         concat_ws(' ',
           case when f.anon and f.definer and f.src !~ 'auth\.(uid|jwt|role)\(' then 'Qualquer pessoa (sem login) roda esta função com poder de dono do banco e ela não confere quem chamou.' end,
           case when f.src ~ 'restore' and f.src !~ 'admin' then 'Tem "restore" (importar backup) e não confere ADMIN no servidor: um usuário comum pode substituir todos os dados.' end,
           case when f.definer and f.cfg !~* 'search_path' then 'security definer sem search_path fixo (use: alter function public.' || f.nome || ' set search_path = '''';).' end,
           case when f.src ~ 'execute\s' and f.src ~ '(\|\||format\s*\()' then 'Monta SQL com texto (EXECUTE): confira se usa format(%I/%L) ou USING, nunca texto do usuário colado.' end,
           case when f.anon then 'anon pode executar. Se só usuário logado usa: revoke execute on function public.' || f.nome || ' from anon, public;' end,
           case when not f.anon and f.definer and f.cfg ~* 'search_path' then 'Só logado executa; search_path fixo.' end,
           case when not f.anon and not f.definer then 'Só logado executa; roda com as permissões de quem chamou (RLS vale).' end)
  from funcoes f

  union all
  -- 5) usuário comum consegue se promover a ADMIN? (item 8)
  select 5, 'Mass assignment: perfil (item 8)', 'profiles.perfil',
         case when not p.existe then 'INFO'
              when p.coluna_gravavel and p.politicas_gravar is not null and p.gatilhos is null then 'FALHA'
              when p.coluna_gravavel and p.politicas_gravar is not null then 'ATENÇÃO'
              else 'OK' end,
         case when not p.existe then 'Tabela profiles não existe.'
              when p.coluna_gravavel and p.politicas_gravar is not null and p.gatilhos is null then
                'Usuário logado pode gravar a coluna perfil e há política que deixa (' || p.politicas_gravar || '). Um vendedor pode virar ADMIN. Corrija: revoke update (perfil) on public.profiles from authenticated; (ou revoke update/insert na tabela e grave só pela função erp-users).'
              when p.coluna_gravavel and p.politicas_gravar is not null then
                'A coluna perfil é gravável e há política (' || p.politicas_gravar || '), mas existe gatilho (' || p.gatilhos || '). Confira se ele impede um não-ADMIN de mudar perfil.'
              else 'Usuário comum não consegue gravar a coluna perfil.' end
  from perfil p

  union all
  -- 6) views ignoram o RLS de quem consulta (item 4)
  select 6, 'View (item 4)', c.relname,
         case when coalesce(array_to_string(c.reloptions, ','), '') ~* 'security_invoker=(true|on)' then 'OK' else 'ATENÇÃO' end,
         case when coalesce(array_to_string(c.reloptions, ','), '') ~* 'security_invoker=(true|on)' then 'security_invoker ligado.'
              else 'A view roda como dono e ignora o RLS. Corrija: alter view public.' || c.relname || ' set (security_invoker = true);' end
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'

  union all
  -- 7) arquivos (Storage) (item 16)
  select 7, 'Storage (item 16)', b.j->>'id',
         case when (b.j->>'public')::boolean then 'ATENÇÃO'
              when b.j->>'file_size_limit' is null or b.j->>'allowed_mime_types' is null then 'ATENÇÃO' else 'OK' end,
         concat_ws(' ',
           case when (b.j->>'public')::boolean then 'Bucket PÚBLICO: qualquer um com o link baixa os arquivos.' end,
           case when b.j->>'file_size_limit' is null then 'Sem limite de tamanho.' end,
           case when b.j->>'allowed_mime_types' is null then 'Aceita qualquer tipo de arquivo.' end,
           case when not (b.j->>'public')::boolean and b.j->>'file_size_limit' is not null and b.j->>'allowed_mime_types' is not null then 'Privado, com limite de tamanho e de tipo.' end)
  from (select to_jsonb(x) as j from storage.buckets x) b

  union all
  -- 8) contas (item 6/12)
  select 8, 'Contas (item 6/12)', 'auth.users',
         case when (select count(*) from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id)) > 0 then 'ATENÇÃO' else 'INFO' end,
         (select count(*) from auth.users) || ' conta(s); ' ||
         (select count(*) from auth.users where email_confirmed_at is null) || ' sem e-mail confirmado; ' ||
         (select count(*) from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id)) || ' sem perfil no sistema (conta que não foi criada pelo ERP?). Últimas contas criadas: ' ||
         coalesce((select string_agg(email || ' (' || to_char(created_at, 'DD/MM/YY') || ')', ', ') from (select email, created_at from auth.users order by created_at desc limit 5) z), '—')

  union all
  select 9, 'Administradores (item 6/8)', 'profiles',
         'INFO',
         'Contas ADMIN: ' || coalesce((select string_agg(coalesce(to_jsonb(p)->>'login', to_jsonb(p)->>'nome', p.id::text), ', ') from public.profiles p where to_jsonb(p)->>'perfil' = 'ADMIN'), 'nenhuma') ||
         '. Se aparecer alguém que você não promoveu, trate como invasão.'

  union all
  -- 9) tempo real só entrega o que o RLS deixa (item 4/15)
  select 10, 'Tempo real (item 15)', pt.tablename,
         case when t.rls then 'OK' else 'FALHA' end,
         case when t.rls then 'Publicada no tempo real; o RLS filtra o que cada um recebe.' else 'Publicada no tempo real SEM RLS: qualquer um escuta as mudanças.' end
  from pg_publication_tables pt join tabelas t on t.tabela = pt.tablename
  where pt.pubname = 'supabase_realtime' and pt.schemaname = 'public'
)
select status, item, objeto, detalhe
from resultado
order by case status when 'FALHA' then 0 when 'ATENÇÃO' then 1 when 'INFO' then 2 else 3 end, ordem, objeto;
