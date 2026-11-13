-- Atualiza o perfil supervisor e restringe exclusoes de pendencias e arquivos.
-- Execute no SQL Editor depois de supabase_pendencias_ajustes_v2.sql.

create or replace function public.admin_atualizar_usuario(
  p_usuario_id uuid,
  p_role text default null,
  p_aprovado boolean default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.clemar_e_admin() then
    raise exception 'Apenas administradores podem alterar acesso de usuarios.' using errcode = '42501';
  end if;
  if p_role is not null and p_role not in ('admin', 'supervisor', 'user') then
    raise exception 'Papel de usuario invalido.' using errcode = '22023';
  end if;
  update public.usuarios
  set role = coalesce(p_role, role),
      aprovado = coalesce(p_aprovado, aprovado)
  where id = p_usuario_id;
  if not found then raise exception 'Usuario nao encontrado.' using errcode = 'P0002'; end if;
end;
$$;
revoke all on function public.admin_atualizar_usuario(uuid, text, boolean) from public, anon;
grant execute on function public.admin_atualizar_usuario(uuid, text, boolean) to authenticated;

drop policy if exists pendencias_relatorio_apaga on public.pendencias;
drop policy if exists pendencias_admin_apaga on public.pendencias;
create policy pendencias_admin_apaga on public.pendencias
for delete to authenticated
using ((select public.clemar_e_admin()));

drop policy if exists pendencia_fotos_admin_apagam on storage.objects;
drop policy if exists pendencia_fotos_admin_apagam on storage.objects;
create policy pendencia_fotos_admin_apagam on storage.objects
for delete to authenticated
using (
  bucket_id = 'pendencia-fotos'
  and (select public.clemar_e_admin())
);
