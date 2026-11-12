-- Execute no Supabase SQL Editor depois de aplicar os demais scripts de esquema.
-- Usuários aprovados podem consultar relatórios compartilhados; somente o dono
-- ou um administrador pode alterar/excluir cada relatório.
-- Fotos privadas: aprovados podem ler; somente dono/admin pode gravar/remover.

alter table public.usuarios enable row level security;
alter table public.relatorios enable row level security;
alter table public.pastas enable row level security;
alter table public.obras_mapa enable row level security;
alter table public.relatorios
  add column if not exists obra_mapa_id uuid references public.obras_mapa(id) on delete set null;
create index if not exists relatorios_obra_mapa_id_idx
  on public.relatorios(obra_mapa_id);

update public.usuarios set role = 'user' where role is null;
update public.usuarios set aprovado = false where aprovado is null;
alter table public.usuarios alter column role set default 'user';
alter table public.usuarios alter column aprovado set default false;

create or replace function public.clemar_e_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select u.role = 'admin'
    from public.usuarios as u
    where u.id = (select auth.uid())
  ), false);
$$;

create or replace function public.clemar_usuario_aprovado()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select u.aprovado is true or u.role = 'admin'
    from public.usuarios as u
    where u.id = (select auth.uid())
  ), false);
$$;

revoke all on function public.clemar_e_admin() from public, anon;
revoke all on function public.clemar_usuario_aprovado() from public, anon;
grant execute on function public.clemar_e_admin() to authenticated;
grant execute on function public.clemar_usuario_aprovado() to authenticated;

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
    raise exception 'Apenas administradores podem alterar acesso de usuários.'
      using errcode = '42501';
  end if;

  if p_role is not null and p_role not in ('admin', 'user') then
    raise exception 'Papel de usuário inválido.' using errcode = '22023';
  end if;

  update public.usuarios
  set role = coalesce(p_role, role),
      aprovado = coalesce(p_aprovado, aprovado)
  where id = p_usuario_id;

  if not found then
    raise exception 'Usuário não encontrado.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.admin_atualizar_usuario(uuid, text, boolean) from public, anon;
grant execute on function public.admin_atualizar_usuario(uuid, text, boolean) to authenticated;

create or replace function public.db_size()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select public.clemar_e_admin())
      then pg_catalog.pg_database_size(pg_catalog.current_database())
    else null
  end;
$$;

revoke execute on function public.db_size() from public;
revoke execute on function public.db_size() from anon;
revoke execute on function public.db_size() from authenticated;
grant execute on function public.db_size() to authenticated;

create or replace function public.storage_size()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select public.clemar_e_admin()) then coalesce((
      select sum(
        case
          when (o.metadata ->> 'size') ~ '^[0-9]+$'
            then (o.metadata ->> 'size')::bigint
          else 0
        end
      )::bigint
      from storage.objects as o
      where o.bucket_id = 'relatorio-fotos'
    ), 0)::bigint
    else null
  end;
$$;

revoke all on function public.storage_size() from public, anon;
grant execute on function public.storage_size() to authenticated;

drop policy if exists "admin atualiza tudo" on public.usuarios;
drop policy if exists "admin deleta tudo" on public.usuarios;
drop policy if exists "admin le tudo" on public.usuarios;
drop policy if exists "usuario insere o proprio" on public.usuarios;
drop policy if exists "usuario le o proprio" on public.usuarios;
drop policy if exists usuarios_leitura_propria_ou_admin on public.usuarios;
drop policy if exists usuarios_insere_proprio_pendente on public.usuarios;
drop policy if exists usuarios_atualiza_proprio_perfil on public.usuarios;
drop policy if exists usuarios_admin_exclui on public.usuarios;

create policy usuarios_leitura_propria_ou_admin on public.usuarios
  for select to authenticated
  using (id = (select auth.uid()) or (select public.clemar_e_admin()));

create policy usuarios_insere_proprio_pendente on public.usuarios
  for insert to authenticated
  with check (
    id = (select auth.uid())
    and role = 'user'
    and aprovado = false
  );

create policy usuarios_atualiza_proprio_perfil on public.usuarios
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy usuarios_admin_exclui on public.usuarios
  for delete to authenticated
  using ((select public.clemar_e_admin()));

drop policy if exists "todos veem todos" on public.relatorios;
drop policy if exists "usuario insere como si mesmo" on public.relatorios;
drop policy if exists "usuarios podem editar todos" on public.relatorios;
drop policy if exists "usuario exclui so seus" on public.relatorios;
drop policy if exists "admin pode excluir tudo" on public.relatorios;
drop policy if exists relatorios_aprovados_leem_todos on public.relatorios;
drop policy if exists relatorios_aprovados_criam_proprios on public.relatorios;
drop policy if exists relatorios_dono_ou_admin_atualiza on public.relatorios;
drop policy if exists relatorios_dono_ou_admin_exclui on public.relatorios;

create policy relatorios_aprovados_leem_todos on public.relatorios
  for select to authenticated
  using ((select public.clemar_usuario_aprovado()));

create policy relatorios_aprovados_criam_proprios on public.relatorios
  for insert to authenticated
  with check (
    (select public.clemar_usuario_aprovado())
    and user_id = (select auth.uid())
  );

create policy relatorios_dono_ou_admin_atualiza on public.relatorios
  for update to authenticated
  using (
    (select public.clemar_e_admin())
    or (
      (select public.clemar_usuario_aprovado())
      and user_id = (select auth.uid())
    )
  )
  with check (
    (select public.clemar_e_admin())
    or (
      (select public.clemar_usuario_aprovado())
      and user_id = (select auth.uid())
    )
  );

create policy relatorios_dono_ou_admin_exclui on public.relatorios
  for delete to authenticated
  using (
    (select public.clemar_e_admin())
    or (
      (select public.clemar_usuario_aprovado())
      and user_id = (select auth.uid())
    )
  );

drop policy if exists "todos gerenciam" on public.pastas;
drop policy if exists "todos leem" on public.pastas;
drop policy if exists pastas_aprovados_leem on public.pastas;
drop policy if exists pastas_aprovados_inserem on public.pastas;
drop policy if exists pastas_aprovados_atualizam on public.pastas;
drop policy if exists pastas_aprovados_excluem on public.pastas;

create policy pastas_aprovados_leem on public.pastas
  for select to authenticated
  using ((select public.clemar_usuario_aprovado()));

create policy pastas_aprovados_inserem on public.pastas
  for insert to authenticated
  with check ((select public.clemar_usuario_aprovado()));

create policy pastas_aprovados_atualizam on public.pastas
  for update to authenticated
  using ((select public.clemar_usuario_aprovado()))
  with check ((select public.clemar_usuario_aprovado()));

create policy pastas_aprovados_excluem on public.pastas
  for delete to authenticated
  using ((select public.clemar_usuario_aprovado()));

drop policy if exists "mapa_leitura_publica" on public.obras_mapa;
drop policy if exists "mapa_escrita_aprovados" on public.obras_mapa;
drop policy if exists mapa_aprovados_acessam on public.obras_mapa;

create policy mapa_aprovados_acessam on public.obras_mapa
  for all to authenticated
  using ((select public.clemar_usuario_aprovado()))
  with check ((select public.clemar_usuario_aprovado()));

do $$
declare
  politica record;
begin
  if to_regclass('public.relatorios_ativo') is not null then
    alter table public.relatorios_ativo enable row level security;

    for politica in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = 'relatorios_ativo'
    loop
      execute format('drop policy %I on public.relatorios_ativo', politica.policyname);
    end loop;

    execute $policy$
      create policy relatorios_ativo_aprovados_leem on public.relatorios_ativo
        for select to authenticated
        using ((select public.clemar_usuario_aprovado()))
    $policy$;
    execute $policy$
      create policy relatorios_ativo_usuario_insere on public.relatorios_ativo
        for insert to authenticated
        with check (
          (select public.clemar_usuario_aprovado())
          and user_id = (select auth.uid())
          and user_email = (select auth.jwt() ->> 'email')
        )
    $policy$;
    execute $policy$
      create policy relatorios_ativo_usuario_atualiza on public.relatorios_ativo
        for update to authenticated
        using (
          (select public.clemar_usuario_aprovado())
          and user_id = (select auth.uid())
        )
        with check (
          (select public.clemar_usuario_aprovado())
          and user_id = (select auth.uid())
          and user_email = (select auth.jwt() ->> 'email')
        )
    $policy$;
    execute $policy$
      create policy relatorios_ativo_usuario_exclui on public.relatorios_ativo
        for delete to authenticated
        using (
          (select public.clemar_e_admin())
          or (
            (select public.clemar_usuario_aprovado())
            and (
              user_id = (select auth.uid())
              or ultima_atividade < now() - interval '5 minutes'
            )
          )
        )
    $policy$;
  end if;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('relatorio-fotos', 'relatorio-fotos', false, 10485760, array['image/jpeg'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

do $$
declare
  politica record;
begin
  for politica in
    select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (
        coalesce(qual, '') like '%relatorio-fotos%'
        or coalesce(with_check, '') like '%relatorio-fotos%'
      )
  loop
    execute format('drop policy %I on storage.objects', politica.policyname);
  end loop;
end;
$$;

create policy relatorio_fotos_aprovados_leem on storage.objects
  for select to authenticated
  using (
    bucket_id = 'relatorio-fotos'
    and (select public.clemar_usuario_aprovado())
  );

create policy relatorio_fotos_dono_ou_admin_inserem on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'relatorio-fotos'
    and (
      (select public.clemar_e_admin())
      or (
        (select public.clemar_usuario_aprovado())
        and exists (
          select 1
          from public.relatorios r
          where r.id::text = (storage.foldername(name))[1]
            and r.user_id = (select auth.uid())
        )
      )
    )
  );

create policy relatorio_fotos_dono_ou_admin_atualizam on storage.objects
  for update to authenticated
  using (
    bucket_id = 'relatorio-fotos'
    and (
      (select public.clemar_e_admin())
      or (
        (select public.clemar_usuario_aprovado())
        and exists (
          select 1
          from public.relatorios r
          where r.id::text = (storage.foldername(name))[1]
            and r.user_id = (select auth.uid())
        )
      )
    )
  )
  with check (
    bucket_id = 'relatorio-fotos'
    and (
      (select public.clemar_e_admin())
      or (
        (select public.clemar_usuario_aprovado())
        and exists (
          select 1
          from public.relatorios r
          where r.id::text = (storage.foldername(name))[1]
            and r.user_id = (select auth.uid())
        )
      )
    )
  );

create policy relatorio_fotos_dono_ou_admin_excluem on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'relatorio-fotos'
    and (
      (select public.clemar_e_admin())
      or (
        (select public.clemar_usuario_aprovado())
        and exists (
          select 1
          from public.relatorios r
          where r.id::text = (storage.foldername(name))[1]
            and r.user_id = (select auth.uid())
        )
      )
    )
  );

revoke all on table public.usuarios, public.relatorios, public.pastas, public.obras_mapa
  from public, anon, authenticated;

grant select, insert, delete on table public.usuarios to authenticated;
grant update (nome, email, ultimo_login) on table public.usuarios to authenticated;
grant insert (id, nome, email, ultimo_login) on table public.usuarios to authenticated;

grant select, insert, update, delete on table public.relatorios to authenticated;
grant select, insert, update, delete on table public.pastas to authenticated;
grant select, insert, update, delete on table public.obras_mapa to authenticated;

do $$
begin
  if to_regclass('public.relatorios_ativo') is not null then
    execute 'revoke all on table public.relatorios_ativo from public, anon, authenticated';
    execute 'grant select, insert, update, delete on table public.relatorios_ativo to authenticated';
  end if;
end;
$$;

do $$
declare
  politica record;
begin
  if to_regclass('public.relatorios_estado') is not null then
    alter table public.relatorios_estado enable row level security;

    for politica in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = 'relatorios_estado'
    loop
      execute format('drop policy %I on public.relatorios_estado', politica.policyname);
    end loop;

    execute $policy$
      create policy relatorios_estado_aprovado_proprio on public.relatorios_estado
        for all to authenticated
        using (
          (select public.clemar_usuario_aprovado())
          and user_id = (select auth.uid())
        )
        with check (
          (select public.clemar_usuario_aprovado())
          and user_id = (select auth.uid())
        )
    $policy$;

    execute 'revoke all on table public.relatorios_estado from public, anon, authenticated';
    execute 'grant select, insert, update, delete on table public.relatorios_estado to authenticated';
  end if;
end;
$$;
