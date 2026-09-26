-- Estúdio 3D — botão "Abrir no Bambu Studio"
-- Rode UMA VEZ no Supabase: Dashboard -> SQL Editor -> New query -> colar -> Run.
--
-- Cria uma pasta PARTICULAR ("bucket" estudio3d). Cada usuário só vê, grava e
-- apaga a própria subpasta (o nome da subpasta é o id dele). O Estúdio guarda
-- ali UM arquivo por usuário (bambu.3mf, sobrescrito a cada envio) e manda pro
-- Bambu Studio um link que vale 15 minutos. Ninguém de fora consegue ler.
-- Não mexe em nenhuma tabela do ERP.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('estudio3d', 'estudio3d', false, 209715200, array['model/3mf', 'application/octet-stream'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "estudio3d: ler a propria pasta" on storage.objects;
drop policy if exists "estudio3d: enviar na propria pasta" on storage.objects;
drop policy if exists "estudio3d: trocar na propria pasta" on storage.objects;
drop policy if exists "estudio3d: apagar na propria pasta" on storage.objects;

create policy "estudio3d: ler a propria pasta" on storage.objects
  for select to authenticated
  using (bucket_id = 'estudio3d' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "estudio3d: enviar na propria pasta" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'estudio3d' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "estudio3d: trocar na propria pasta" on storage.objects
  for update to authenticated
  using (bucket_id = 'estudio3d' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'estudio3d' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "estudio3d: apagar na propria pasta" on storage.objects
  for delete to authenticated
  using (bucket_id = 'estudio3d' and (storage.foldername(name))[1] = auth.uid()::text);
