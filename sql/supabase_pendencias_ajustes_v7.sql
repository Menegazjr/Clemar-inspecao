-- Exclusao controlada de atividades sem apagar a trilha de auditoria.
-- Execute depois de supabase_pendencias_ajustes_v6.sql.

alter table public.pendencias_atividades
  add column if not exists excluido_em timestamptz,
  add column if not exists excluido_por uuid references public.usuarios(id) on delete set null,
  add column if not exists excluido_por_nome text;

alter table public.pendencias_atividades_historico
  drop constraint if exists pendencias_atividades_historico_evento_check;
alter table public.pendencias_atividades_historico
  add constraint pendencias_atividades_historico_evento_check
  check (evento in (
    'criada',
    'titulo_alterado',
    'descricao_alterada',
    'responsavel_alterado',
    'status_alterado',
    'prazo_alterado',
    'comentario',
    'atividade_excluida'
  ));

create or replace function public.pendencia_atividade_excluir(
  p_atividade_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_atividade public.pendencias_atividades%rowtype;
  v_usuario_nome text;
begin
  if not public.clemar_e_supervisor() then
    raise exception 'Somente administradores e supervisores podem excluir atividades.'
      using errcode = '42501';
  end if;

  select * into v_atividade
  from public.pendencias_atividades
  where id = p_atividade_id
    and excluido_em is null
  for update;
  if not found then
    raise exception 'Atividade nao encontrada ou ja excluida.'
      using errcode = 'P0002';
  end if;

  select coalesce(nullif(btrim(u.nome), ''), u.email, 'Usuario')
    into v_usuario_nome
  from public.usuarios u
  where u.id = (select auth.uid());

  update public.pendencias_atividades
  set excluido_em = now(),
      excluido_por = (select auth.uid()),
      excluido_por_nome = coalesce(v_usuario_nome, 'Usuario'),
      atualizado_em = now()
  where id = p_atividade_id;

  insert into public.pendencias_atividades_historico(
    atividade_id, evento, detalhes, usuario_id, usuario_nome
  )
  values (
    p_atividade_id,
    'atividade_excluida',
    jsonb_build_object('titulo', v_atividade.titulo, 'pendencia_id', v_atividade.pendencia_id),
    (select auth.uid()),
    coalesce(v_usuario_nome, 'Usuario')
  );
end;
$$;
revoke all on function public.pendencia_atividade_excluir(uuid) from public, anon;
grant execute on function public.pendencia_atividade_excluir(uuid) to authenticated;

revoke all on function public.pendencia_atividade_comentar(uuid, text)
  from public, anon, authenticated;

create or replace function public.pendencia_atividade_bloquear_edicao_excluida()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.excluido_em is not null then
    raise exception 'Atividade excluida nao pode ser alterada.'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists pendencias_atividade_edicao_excluida on public.pendencias_atividades;
create trigger pendencias_atividade_edicao_excluida
  before update on public.pendencias_atividades
  for each row execute function public.pendencia_atividade_bloquear_edicao_excluida();
