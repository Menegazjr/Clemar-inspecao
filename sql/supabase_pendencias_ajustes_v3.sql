-- Somente administradores podem excluir pendencias e os arquivos associados.
-- Execute no SQL Editor depois de supabase_pendencias_ajustes_v2.sql.

drop policy if exists pendencias_relatorio_apaga on public.pendencias;
create policy pendencias_admin_apaga on public.pendencias
for delete to authenticated
using ((select public.clemar_e_admin()));

drop policy if exists pendencia_fotos_admin_apagam on storage.objects;
create policy pendencia_fotos_admin_apagam on storage.objects
for delete to authenticated
using (
  bucket_id = 'pendencia-fotos'
  and (select public.clemar_e_admin())
);
