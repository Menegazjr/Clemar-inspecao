-- Responsaveis, atividades e trilha de auditoria do modulo de pendencias.
-- Execute depois de supabase_pendencias_ajustes_v4.sql.

alter table public.pendencias
  add column if not exists responsavel_id uuid references public.usuarios(id) on delete set null,
  add column if not exists responsavel_nome text,
  add column if not exists responsavel_atribuido_por uuid references public.usuarios(id) on delete set null,
  add column if not exists responsavel_atribuido_por_nome text,
  add column if not exists responsavel_atribuido_em timestamptz;

alter table public.pendencias_historico
  drop constraint if exists pendencias_historico_evento_check;
alter table public.pendencias_historico
  add constraint pendencias_historico_evento_check
  check (evento in (
    'criada',
    'responsavel_atribuido',
    'responsavel_alterado',
    'responsavel_removido',
    'correcao_enviada',
    'devolvida',
    'aprovada'
  ));

create index if not exists pendencias_responsavel_idx
  on public.pendencias(responsavel_id, status);

create table if not exists public.pendencias_atividades (
  id uuid primary key default gen_random_uuid(),
  pendencia_id uuid not null references public.pendencias(id) on delete cascade,
  titulo text not null check (length(trim(titulo)) > 0 and length(titulo) <= 160),
  descricao text not null check (length(trim(descricao)) > 0 and length(descricao) <= 5000),
  responsavel_id uuid references public.usuarios(id) on delete set null,
  responsavel_nome text,
  responsavel_atribuido_por uuid references public.usuarios(id) on delete set null,
  responsavel_atribuido_por_nome text,
  responsavel_atribuido_em timestamptz,
  status text not null default 'nao_iniciada'
    check (status in ('nao_iniciada','em_andamento','aguardando_terceiros','concluida','cancelada')),
  prazo date,
  criado_por uuid references public.usuarios(id) on delete set null,
  criado_por_nome text not null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  concluido_em timestamptz
);
create index if not exists pendencias_atividades_pendencia_idx
  on public.pendencias_atividades(pendencia_id, criado_em);
create index if not exists pendencias_atividades_responsavel_idx
  on public.pendencias_atividades(responsavel_id, status);

create table if not exists public.pendencias_atividades_historico (
  id bigint generated always as identity primary key,
  atividade_id uuid not null references public.pendencias_atividades(id) on delete cascade,
  evento text not null check (evento in (
    'criada',
    'titulo_alterado',
    'descricao_alterada',
    'responsavel_alterado',
    'status_alterado',
    'prazo_alterado',
    'comentario'
  )),
  detalhes jsonb not null default '{}'::jsonb,
  comentario text check (comentario is null or length(comentario) <= 5000),
  usuario_id uuid references public.usuarios(id) on delete set null,
  usuario_nome text not null,
  criado_em timestamptz not null default now()
);
create index if not exists pendencias_atividades_historico_idx
  on public.pendencias_atividades_historico(atividade_id, criado_em);

alter table public.pendencias_atividades enable row level security;
alter table public.pendencias_atividades_historico enable row level security;
drop policy if exists pendencias_atividades_aprovados_leem on public.pendencias_atividades;
create policy pendencias_atividades_aprovados_leem
  on public.pendencias_atividades for select to authenticated
  using ((select public.clemar_usuario_aprovado()));
drop policy if exists pendencias_atividades_historico_aprovados_leem on public.pendencias_atividades_historico;
create policy pendencias_atividades_historico_aprovados_leem
  on public.pendencias_atividades_historico for select to authenticated
  using ((select public.clemar_usuario_aprovado()));

revoke all on table public.pendencias_atividades,
  public.pendencias_atividades_historico from public, anon, authenticated;
grant select on table public.pendencias_atividades,
  public.pendencias_atividades_historico to authenticated;

-- Toda escrita no historico ocorre por triggers ou RPCs SECURITY DEFINER.
drop policy if exists pendencias_historico_aprovados_criam on public.pendencias_historico;
revoke insert on table public.pendencias_historico from authenticated;

create or replace function public.pendencias_listar_responsaveis()
returns table (id uuid, nome text, email text, role text, aprovado boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id,
         coalesce(nullif(btrim(u.nome), ''), u.email, 'Usuario'),
         u.email,
         u.role,
         u.aprovado
  from public.usuarios u
  where (select public.clemar_usuario_aprovado())
  order by coalesce(nullif(btrim(u.nome), ''), u.email, 'Usuario');
$$;
revoke all on function public.pendencias_listar_responsaveis() from public, anon;
grant execute on function public.pendencias_listar_responsaveis() to authenticated;

create or replace function public.pendencia_atribuir_responsavel(
  p_pendencia_id uuid,
  p_responsavel_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pendencia public.pendencias%rowtype;
  v_responsavel_nome text;
  v_usuario_nome text;
  v_evento text;
begin
  if not public.clemar_e_supervisor() then
    raise exception 'Somente administradores e supervisores podem atribuir o responsavel principal.'
      using errcode = '42501';
  end if;

  select * into v_pendencia
  from public.pendencias
  where id = p_pendencia_id
  for update;
  if not found then raise exception 'Pendencia nao encontrada.' using errcode = 'P0002'; end if;

  if p_responsavel_id is not null then
    select coalesce(nullif(btrim(u.nome), ''), u.email, 'Usuario')
      into v_responsavel_nome
    from public.usuarios u
    where u.id = p_responsavel_id;
    if not found then raise exception 'Usuario responsavel nao encontrado.' using errcode = 'P0002'; end if;
  end if;

  if v_pendencia.responsavel_id is not distinct from p_responsavel_id then return; end if;

  select coalesce(nullif(btrim(u.nome), ''), u.email, 'Usuario')
    into v_usuario_nome
  from public.usuarios u
  where u.id = (select auth.uid());

  v_evento := case
    when v_pendencia.responsavel_id is null then 'responsavel_atribuido'
    when p_responsavel_id is null then 'responsavel_removido'
    else 'responsavel_alterado'
  end;

  update public.pendencias
  set responsavel_id = p_responsavel_id,
      responsavel_nome = v_responsavel_nome,
      responsavel_atribuido_por = (select auth.uid()),
      responsavel_atribuido_por_nome = coalesce(v_usuario_nome, 'Usuario'),
      responsavel_atribuido_em = now(),
      atualizado_em = now()
  where id = p_pendencia_id;

  insert into public.pendencias_historico(pendencia_id, evento, descricao, usuario_id, usuario_nome)
  values (
    p_pendencia_id,
    v_evento,
    'Responsavel principal: ' || coalesce(v_pendencia.responsavel_nome, 'Nao atribuido')
      || ' -> ' || coalesce(v_responsavel_nome, 'Nao atribuido'),
    (select auth.uid()),
    coalesce(v_usuario_nome, 'Usuario')
  );
end;
$$;
revoke all on function public.pendencia_atribuir_responsavel(uuid, uuid) from public, anon;
grant execute on function public.pendencia_atribuir_responsavel(uuid, uuid) to authenticated;

create or replace function public.pendencia_atividade_criar(
  p_pendencia_id uuid,
  p_titulo text,
  p_descricao text,
  p_responsavel_id uuid,
  p_prazo date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_atividade_id uuid;
  v_usuario_nome text;
  v_responsavel_nome text;
begin
  if not public.clemar_usuario_aprovado() then
    raise exception 'Acesso nao autorizado.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_titulo, ''))) = 0 then
    raise exception 'Informe o titulo da atividade.' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_descricao, ''))) = 0 then
    raise exception 'Informe a descricao da atividade.' using errcode = '22023';
  end if;
  if p_responsavel_id is null then
    raise exception 'Selecione um responsavel para a atividade.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.pendencias p where p.id = p_pendencia_id) then
    raise exception 'Pendencia nao encontrada.' using errcode = 'P0002';
  end if;

  select coalesce(nullif(btrim(u.nome), ''), u.email, 'Usuario')
    into v_usuario_nome
  from public.usuarios u
  where u.id = (select auth.uid());
  select coalesce(nullif(btrim(u.nome), ''), u.email, 'Usuario')
    into v_responsavel_nome
  from public.usuarios u
  where u.id = p_responsavel_id;
  if not found then raise exception 'Usuario responsavel nao encontrado.' using errcode = 'P0002'; end if;

  insert into public.pendencias_atividades(
    pendencia_id, titulo, descricao, responsavel_id, responsavel_nome,
    responsavel_atribuido_por, responsavel_atribuido_por_nome, responsavel_atribuido_em,
    status, prazo, criado_por, criado_por_nome
  )
  values (
    p_pendencia_id, trim(p_titulo), trim(p_descricao), p_responsavel_id, v_responsavel_nome,
    (select auth.uid()), coalesce(v_usuario_nome, 'Usuario'), now(),
    'nao_iniciada', p_prazo, (select auth.uid()), coalesce(v_usuario_nome, 'Usuario')
  )
  returning id into v_atividade_id;

  insert into public.pendencias_atividades_historico(atividade_id, evento, detalhes, usuario_id, usuario_nome)
  values (
    v_atividade_id,
    'criada',
    jsonb_build_object('titulo', trim(p_titulo), 'descricao', trim(p_descricao),
      'responsavel', v_responsavel_nome, 'status', 'nao_iniciada', 'prazo', p_prazo),
    (select auth.uid()),
    coalesce(v_usuario_nome, 'Usuario')
  );
  return v_atividade_id;
end;
$$;
revoke all on function public.pendencia_atividade_criar(uuid, text, text, uuid, date) from public, anon;
grant execute on function public.pendencia_atividade_criar(uuid, text, text, uuid, date) to authenticated;

create or replace function public.pendencia_atividade_atualizar(
  p_atividade_id uuid,
  p_titulo text,
  p_descricao text,
  p_responsavel_id uuid,
  p_status text,
  p_prazo date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_atividade public.pendencias_atividades%rowtype;
  v_usuario_nome text;
  v_responsavel_nome text;
  v_titulo text := trim(coalesce(p_titulo, ''));
  v_descricao text := trim(coalesce(p_descricao, ''));
begin
  if not public.clemar_usuario_aprovado() then
    raise exception 'Acesso nao autorizado.' using errcode = '42501';
  end if;
  if v_titulo = '' then raise exception 'Informe o titulo da atividade.' using errcode = '22023'; end if;
  if v_descricao = '' then raise exception 'Informe a descricao da atividade.' using errcode = '22023'; end if;
  if p_status is null or p_status not in ('nao_iniciada','em_andamento','aguardando_terceiros','concluida','cancelada') then
    raise exception 'Status de atividade invalido.' using errcode = '22023';
  end if;

  select * into v_atividade
  from public.pendencias_atividades
  where id = p_atividade_id
  for update;
  if not found then raise exception 'Atividade nao encontrada.' using errcode = 'P0002'; end if;

  if p_responsavel_id is not null then
    select coalesce(nullif(btrim(u.nome), ''), u.email, 'Usuario')
      into v_responsavel_nome
    from public.usuarios u
    where u.id = p_responsavel_id;
    if not found then raise exception 'Usuario responsavel nao encontrado.' using errcode = 'P0002'; end if;
  end if;
  select coalesce(nullif(btrim(u.nome), ''), u.email, 'Usuario')
    into v_usuario_nome
  from public.usuarios u
  where u.id = (select auth.uid());

  if v_atividade.titulo is not distinct from v_titulo
     and v_atividade.descricao is not distinct from v_descricao
     and v_atividade.responsavel_id is not distinct from p_responsavel_id
     and v_atividade.status is not distinct from p_status
     and v_atividade.prazo is not distinct from p_prazo then
    return;
  end if;

  update public.pendencias_atividades
  set titulo = v_titulo,
      descricao = v_descricao,
      responsavel_id = p_responsavel_id,
      responsavel_nome = v_responsavel_nome,
      responsavel_atribuido_por = case
        when v_atividade.responsavel_id is distinct from p_responsavel_id then (select auth.uid())
        else responsavel_atribuido_por end,
      responsavel_atribuido_por_nome = case
        when v_atividade.responsavel_id is distinct from p_responsavel_id then coalesce(v_usuario_nome, 'Usuario')
        else responsavel_atribuido_por_nome end,
      responsavel_atribuido_em = case
        when v_atividade.responsavel_id is distinct from p_responsavel_id then now()
        else responsavel_atribuido_em end,
      status = p_status,
      prazo = p_prazo,
      concluido_em = case when p_status = 'concluida' then coalesce(concluido_em, now()) else null end,
      atualizado_em = now()
  where id = p_atividade_id;

  if v_atividade.titulo is distinct from v_titulo then
    insert into public.pendencias_atividades_historico(atividade_id, evento, detalhes, usuario_id, usuario_nome)
    values (p_atividade_id, 'titulo_alterado', jsonb_build_object('antes', v_atividade.titulo, 'depois', v_titulo), (select auth.uid()), coalesce(v_usuario_nome, 'Usuario'));
  end if;
  if v_atividade.descricao is distinct from v_descricao then
    insert into public.pendencias_atividades_historico(atividade_id, evento, detalhes, usuario_id, usuario_nome)
    values (p_atividade_id, 'descricao_alterada', jsonb_build_object('antes', v_atividade.descricao, 'depois', v_descricao), (select auth.uid()), coalesce(v_usuario_nome, 'Usuario'));
  end if;
  if v_atividade.responsavel_id is distinct from p_responsavel_id then
    insert into public.pendencias_atividades_historico(atividade_id, evento, detalhes, usuario_id, usuario_nome)
    values (p_atividade_id, 'responsavel_alterado', jsonb_build_object('antes', v_atividade.responsavel_nome, 'depois', v_responsavel_nome), (select auth.uid()), coalesce(v_usuario_nome, 'Usuario'));
  end if;
  if v_atividade.status is distinct from p_status then
    insert into public.pendencias_atividades_historico(atividade_id, evento, detalhes, usuario_id, usuario_nome)
    values (p_atividade_id, 'status_alterado', jsonb_build_object('antes', v_atividade.status, 'depois', p_status,
      'concluido_em', case when p_status = 'concluida' then now() else null end), (select auth.uid()), coalesce(v_usuario_nome, 'Usuario'));
  end if;
  if v_atividade.prazo is distinct from p_prazo then
    insert into public.pendencias_atividades_historico(atividade_id, evento, detalhes, usuario_id, usuario_nome)
    values (p_atividade_id, 'prazo_alterado', jsonb_build_object('antes', v_atividade.prazo, 'depois', p_prazo), (select auth.uid()), coalesce(v_usuario_nome, 'Usuario'));
  end if;
end;
$$;
revoke all on function public.pendencia_atividade_atualizar(uuid, text, text, uuid, text, date) from public, anon;
grant execute on function public.pendencia_atividade_atualizar(uuid, text, text, uuid, text, date) to authenticated;

create or replace function public.pendencia_atividade_comentar(
  p_atividade_id uuid,
  p_comentario text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario_nome text;
begin
  if not public.clemar_usuario_aprovado() then
    raise exception 'Acesso nao autorizado.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_comentario, ''))) = 0 then
    raise exception 'Escreva um comentario antes de adicionar.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.pendencias_atividades a where a.id = p_atividade_id) then
    raise exception 'Atividade nao encontrada.' using errcode = 'P0002';
  end if;
  select coalesce(nullif(btrim(u.nome), ''), u.email, 'Usuario')
    into v_usuario_nome
  from public.usuarios u
  where u.id = (select auth.uid());

  insert into public.pendencias_atividades_historico(atividade_id, evento, comentario, usuario_id, usuario_nome)
  values (p_atividade_id, 'comentario', trim(p_comentario), (select auth.uid()), coalesce(v_usuario_nome, 'Usuario'));
  update public.pendencias_atividades
  set atualizado_em = now()
  where id = p_atividade_id;
end;
$$;
revoke all on function public.pendencia_atividade_comentar(uuid, text) from public, anon;
grant execute on function public.pendencia_atividade_comentar(uuid, text) to authenticated;
