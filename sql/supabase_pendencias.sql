-- Módulo de Pendências - Clemar Inspeções
-- Execute no SQL Editor do mesmo projeto Supabase, após as migrações existentes.

-- 1) Perfil supervisor (admin continua tendo todos os privilégios administrativos).
create or replace function public.clemar_e_supervisor()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select u.role in ('admin', 'supervisor')
    from public.usuarios u where u.id = (select auth.uid())
  ), false);
$$;
revoke all on function public.clemar_e_supervisor() from public, anon;
grant execute on function public.clemar_e_supervisor() to authenticated;

create or replace function public.clemar_usuario_aprovado()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select u.aprovado is true or u.role in ('admin', 'supervisor')
    from public.usuarios u where u.id = (select auth.uid())
  ), false);
$$;
revoke all on function public.clemar_usuario_aprovado() from public, anon;
grant execute on function public.clemar_usuario_aprovado() to authenticated;

-- Atualiza a RPC já utilizada pela tela Gestão para permitir o perfil supervisor.
create or replace function public.admin_atualizar_usuario(
  p_usuario_id uuid,
  p_role text default null,
  p_aprovado boolean default null
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.clemar_e_admin() then
    raise exception 'Apenas administradores podem alterar acesso de usuários.' using errcode = '42501';
  end if;
  if p_role is not null and p_role not in ('admin', 'supervisor', 'user') then
    raise exception 'Papel de usuário inválido.' using errcode = '22023';
  end if;
  update public.usuarios
  set role = coalesce(p_role, role), aprovado = coalesce(p_aprovado, aprovado)
  where id = p_usuario_id;
  if not found then raise exception 'Usuário não encontrado.' using errcode = 'P0002'; end if;
end;
$$;
revoke all on function public.admin_atualizar_usuario(uuid, text, boolean) from public, anon;
grant execute on function public.admin_atualizar_usuario(uuid, text, boolean) to authenticated;

-- Inclui as novas fotos de correção no indicador de armazenamento da Gestão.
create or replace function public.storage_size()
returns bigint language sql stable security definer set search_path = '' as $$
  select case when (select public.clemar_e_admin()) then coalesce((
    select sum(case when (o.metadata ->> 'size') ~ '^[0-9]+$'
      then (o.metadata ->> 'size')::bigint else 0 end)::bigint
    from storage.objects o
    where o.bucket_id in ('relatorio-fotos','pendencia-fotos')
  ), 0)::bigint else null end;
$$;
revoke all on function public.storage_size() from public, anon;
grant execute on function public.storage_size() to authenticated;

-- 2) Tabelas.
create table if not exists public.pendencias (
  id uuid primary key default gen_random_uuid(),
  obra_mapa_id uuid not null references public.obras_mapa(id) on delete restrict,
  relatorio_id uuid references public.relatorios(id) on delete set null,
  descricao text not null check (length(trim(descricao)) > 0),
  fotos jsonb not null default '[]'::jsonb,
  prazo date,
  status text not null default 'pendente' check (status in ('pendente','aguardando_validacao','concluida')),
  criado_por uuid references public.usuarios(id) on delete set null,
  criado_por_nome text not null,
  criado_em timestamptz not null default now(),
  corrigido_por uuid references public.usuarios(id) on delete set null,
  corrigido_por_nome text,
  correcao_texto text,
  corrigido_em timestamptz,
  fotos_correcao jsonb not null default '[]'::jsonb,
  aprovado_por uuid references public.usuarios(id) on delete set null,
  aprovado_por_nome text,
  aprovado_em timestamptz,
  motivo_devolucao text,
  atualizado_em timestamptz not null default now()
);
create index if not exists pendencias_obra_status_idx on public.pendencias(obra_mapa_id, status);
create index if not exists pendencias_prazo_idx on public.pendencias(prazo) where status <> 'concluida';
create index if not exists pendencias_relatorio_idx on public.pendencias(relatorio_id);

create table if not exists public.pendencias_historico (
  id bigint generated always as identity primary key,
  pendencia_id uuid not null references public.pendencias(id) on delete cascade,
  evento text not null check (evento in ('criada','correcao_enviada','devolvida','aprovada')),
  descricao text,
  fotos jsonb not null default '[]'::jsonb,
  motivo text,
  usuario_id uuid references public.usuarios(id) on delete set null,
  usuario_nome text not null,
  criado_em timestamptz not null default now()
);
create index if not exists pendencias_historico_pendencia_idx on public.pendencias_historico(pendencia_id, criado_em);

create or replace function public.pendencias_preparar_criacao()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_nome text;
begin
  if new.relatorio_id is not null and not exists (
    select 1 from public.relatorios r
    where r.id = new.relatorio_id and r.obra_mapa_id = new.obra_mapa_id
  ) then
    raise exception 'O relatório selecionado não pertence à obra informada.' using errcode = '22023';
  end if;
  select nome into v_nome from public.usuarios where id = (select auth.uid());
  new.criado_por := (select auth.uid());
  new.criado_por_nome := coalesce(v_nome, 'Usuário');
  new.status := 'pendente';
  new.corrigido_por := null; new.corrigido_por_nome := null; new.correcao_texto := null;
  new.corrigido_em := null; new.fotos_correcao := '[]'::jsonb;
  new.aprovado_por := null; new.aprovado_por_nome := null; new.aprovado_em := null;
  new.motivo_devolucao := null;
  return new;
end;
$$;
drop trigger if exists pendencias_antes_criar on public.pendencias;
create trigger pendencias_antes_criar before insert on public.pendencias
for each row execute function public.pendencias_preparar_criacao();

create or replace function public.pendencias_registrar_criacao()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.pendencias_historico(pendencia_id, evento, descricao, usuario_id, usuario_nome)
  values (new.id, 'criada', new.descricao, new.criado_por, new.criado_por_nome);
  return new;
end;
$$;
drop trigger if exists pendencias_apos_criar on public.pendencias;
create trigger pendencias_apos_criar after insert on public.pendencias
for each row execute function public.pendencias_registrar_criacao();

-- 3) Correção enviada pelo usuário autenticado. Texto obrigatório; fotos opcionais.
create or replace function public.pendencia_registrar_correcao(
  p_pendencia_id uuid,
  p_texto text,
  p_fotos jsonb default '[]'::jsonb
)
returns void language plpgsql security definer set search_path = '' as $$
declare v_nome text; v_status text;
begin
  if not public.clemar_usuario_aprovado() then raise exception 'Acesso não autorizado.' using errcode = '42501'; end if;
  if length(trim(coalesce(p_texto,''))) = 0 then raise exception 'Descreva a correção realizada.' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_fotos, '[]'::jsonb)) <> 'array' then raise exception 'Lista de fotos inválida.' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements_text(coalesce(p_fotos, '[]'::jsonb)) f(path)
    where left(f.path, length(p_pendencia_id::text) + 1) <> p_pendencia_id::text || '/') then
    raise exception 'As fotos devem pertencer a esta pendência.' using errcode = '22023';
  end if;
  select nome into v_nome from public.usuarios where id = (select auth.uid());
  select status into v_status from public.pendencias where id = p_pendencia_id for update;
  if not found then raise exception 'Pendência não encontrada.' using errcode = 'P0002'; end if;
  if v_status <> 'pendente' then raise exception 'Esta pendência não está aguardando correção.' using errcode = '22023'; end if;
  update public.pendencias set
    status = 'aguardando_validacao', correcao_texto = trim(p_texto),
    corrigido_por = (select auth.uid()), corrigido_por_nome = coalesce(v_nome, 'Usuário'),
    corrigido_em = now(), fotos_correcao = coalesce(p_fotos, '[]'::jsonb),
    aprovado_por = null, aprovado_por_nome = null, aprovado_em = null,
    motivo_devolucao = null, atualizado_em = now()
  where id = p_pendencia_id;
  insert into public.pendencias_historico(pendencia_id, evento, descricao, fotos, usuario_id, usuario_nome)
  values (p_pendencia_id, 'correcao_enviada', trim(p_texto), coalesce(p_fotos,'[]'::jsonb), (select auth.uid()), coalesce(v_nome,'Usuário'));
end;
$$;
revoke all on function public.pendencia_registrar_correcao(uuid, text, jsonb) from public, anon;
grant execute on function public.pendencia_registrar_correcao(uuid, text, jsonb) to authenticated;

-- 4) Somente supervisor/admin pode aprovar ou devolver. Devolução exige justificativa.
create or replace function public.pendencia_validar(
  p_pendencia_id uuid,
  p_aprovar boolean,
  p_motivo text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare v_nome text; v_status text;
begin
  if not public.clemar_e_supervisor() then raise exception 'Somente um supervisor pode validar a correção.' using errcode = '42501'; end if;
  select nome into v_nome from public.usuarios where id = (select auth.uid());
  select status into v_status from public.pendencias where id = p_pendencia_id for update;
  if not found then raise exception 'Pendência não encontrada.' using errcode = 'P0002'; end if;
  if v_status <> 'aguardando_validacao' then raise exception 'Esta pendência não está aguardando validação.' using errcode = '22023'; end if;
  if p_aprovar then
    update public.pendencias set status = 'concluida', aprovado_por = (select auth.uid()),
      aprovado_por_nome = coalesce(v_nome,'Supervisor'), aprovado_em = now(), motivo_devolucao = null, atualizado_em = now()
    where id = p_pendencia_id;
    insert into public.pendencias_historico(pendencia_id, evento, usuario_id, usuario_nome)
    values (p_pendencia_id, 'aprovada', (select auth.uid()), coalesce(v_nome,'Supervisor'));
  else
    if length(trim(coalesce(p_motivo,''))) = 0 then raise exception 'Informe o motivo da devolução.' using errcode = '22023'; end if;
    update public.pendencias set status = 'pendente', motivo_devolucao = trim(p_motivo),
      aprovado_por = null, aprovado_por_nome = null, aprovado_em = null, atualizado_em = now()
    where id = p_pendencia_id;
    insert into public.pendencias_historico(pendencia_id, evento, motivo, usuario_id, usuario_nome)
    values (p_pendencia_id, 'devolvida', trim(p_motivo), (select auth.uid()), coalesce(v_nome,'Supervisor'));
  end if;
end;
$$;
revoke all on function public.pendencia_validar(uuid, boolean, text) from public, anon;
grant execute on function public.pendencia_validar(uuid, boolean, text) to authenticated;

-- 5) RLS. Usuários aprovados visualizam e registram; transições passam pelas RPCs acima.
alter table public.pendencias enable row level security;
alter table public.pendencias_historico enable row level security;
drop policy if exists pendencias_aprovados_leem on public.pendencias;
create policy pendencias_aprovados_leem on public.pendencias for select to authenticated
using ((select public.clemar_usuario_aprovado()));
drop policy if exists pendencias_aprovados_criam on public.pendencias;
create policy pendencias_aprovados_criam on public.pendencias for insert to authenticated
with check ((select public.clemar_usuario_aprovado()) and criado_por = (select auth.uid()));
drop policy if exists pendencias_historico_aprovados_leem on public.pendencias_historico;
create policy pendencias_historico_aprovados_leem on public.pendencias_historico for select to authenticated
using ((select public.clemar_usuario_aprovado()));
drop policy if exists pendencias_historico_aprovados_criam on public.pendencias_historico;
create policy pendencias_historico_aprovados_criam on public.pendencias_historico for insert to authenticated
with check ((select public.clemar_usuario_aprovado()) and usuario_id = (select auth.uid()));
revoke all on table public.pendencias, public.pendencias_historico from public, anon, authenticated;
grant select on table public.pendencias to authenticated;
grant insert (id, obra_mapa_id, relatorio_id, descricao, prazo, fotos) on table public.pendencias to authenticated;
grant delete on table public.pendencias to authenticated;
drop policy if exists pendencias_relatorio_apaga on public.pendencias;
create policy pendencias_relatorio_apaga on public.pendencias for delete to authenticated using (public.clemar_usuario_aprovado() and (public.clemar_e_supervisor() or criado_por = auth.uid() or exists (select 1 from public.relatorios r where r.id = pendencias.relatorio_id and r.user_id = auth.uid())));
grant select on table public.pendencias_historico to authenticated;

-- 6) Bucket privado para fotos de correção.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pendencia-fotos','pendencia-fotos',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists pendencia_fotos_aprovados_leem on storage.objects;
create policy pendencia_fotos_aprovados_leem on storage.objects for select to authenticated
using (bucket_id = 'pendencia-fotos' and (select public.clemar_usuario_aprovado()));
drop policy if exists pendencia_fotos_aprovados_inserem on storage.objects;
create policy pendencia_fotos_aprovados_inserem on storage.objects for insert to authenticated
with check (bucket_id = 'pendencia-fotos' and (select public.clemar_usuario_aprovado())
  and exists (select 1 from public.pendencias p where p.id::text = (storage.foldername(name))[1]));
