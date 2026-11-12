-- Rode no Supabase (SQL Editor) ANTES de subir os arquivos novos.
-- Cria o "bucket" privado das fotos e libera acesso só para usuários aprovados (ou admin).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('relatorio-fotos', 'relatorio-fotos', false, 10485760, array['image/jpeg'])
on conflict (id) do nothing;

drop policy if exists "fotos_select" on storage.objects;
drop policy if exists "fotos_insert" on storage.objects;
drop policy if exists "fotos_update" on storage.objects;
drop policy if exists "fotos_delete" on storage.objects;

create policy "fotos_select" on storage.objects for select to authenticated
  using (bucket_id = 'relatorio-fotos' and exists (select 1 from public.usuarios u where u.id = auth.uid() and (u.aprovado = true or u.role = 'admin')));
create policy "fotos_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'relatorio-fotos' and exists (select 1 from public.usuarios u where u.id = auth.uid() and (u.aprovado = true or u.role = 'admin')));
create policy "fotos_update" on storage.objects for update to authenticated
  using (bucket_id = 'relatorio-fotos' and exists (select 1 from public.usuarios u where u.id = auth.uid() and (u.aprovado = true or u.role = 'admin')))
  with check (bucket_id = 'relatorio-fotos');
create policy "fotos_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'relatorio-fotos' and exists (select 1 from public.usuarios u where u.id = auth.uid() and (u.aprovado = true or u.role = 'admin')));
