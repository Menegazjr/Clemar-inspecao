-- Allows report owners and administrators to edit linked pending descriptions.
-- Execute after supabase_pendencias_ajustes_v5.sql.

alter table public.pendencias_historico
  drop constraint if exists pendencias_historico_evento_check;

alter table public.pendencias_historico
  add constraint pendencias_historico_evento_check
  check (evento in (
    'criada',
    'responsavel_atribuido',
    'responsavel_alterado',
    'responsavel_removido',
    'titulo_alterado',
    'descricao_alterada',
    'correcao_enviada',
    'devolvida',
    'aprovada'
  ));

create or replace function public.pendencia_editar_conteudo(
  p_pendencia_id uuid,
  p_titulo text,
  p_descricao text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pendencia public.pendencias%rowtype;
  v_titulo text := btrim(coalesce(p_titulo, ''));
  v_descricao text := btrim(coalesce(p_descricao, ''));
  v_usuario_nome text;
begin
  if not public.clemar_usuario_aprovado() then
    raise exception 'Acesso nao autorizado.' using errcode = '42501';
  end if;
  if length(v_titulo) = 0 or length(v_titulo) > 160 then
    raise exception 'Informe um titulo de ate 160 caracteres.' using errcode = '22023';
  end if;
  if length(v_descricao) = 0 then
    raise exception 'Informe a descricao da pendencia.' using errcode = '22023';
  end if;

  select * into v_pendencia
  from public.pendencias
  where id = p_pendencia_id
  for update;
  if not found then
    raise exception 'Pendencia nao encontrada.' using errcode = 'P0002';
  end if;
  if v_pendencia.relatorio_id is null or not exists (
    select 1
    from public.relatorios r
    where r.id = v_pendencia.relatorio_id
      and (r.user_id = (select auth.uid()) or (select public.clemar_e_admin()))
  ) then
    raise exception 'Somente o autor do relatorio ou um administrador pode alterar esta pendencia.'
      using errcode = '42501';
  end if;

  if v_pendencia.titulo is not distinct from v_titulo
     and v_pendencia.descricao is not distinct from v_descricao then
    return;
  end if;

  select coalesce(nullif(btrim(u.nome), ''), u.email, 'Usuario')
    into v_usuario_nome
  from public.usuarios u
  where u.id = (select auth.uid());

  update public.pendencias
  set titulo = v_titulo,
      descricao = v_descricao,
      atualizado_em = now()
  where id = p_pendencia_id;

  if v_pendencia.titulo is distinct from v_titulo then
    insert into public.pendencias_historico(
      pendencia_id, evento, descricao, usuario_id, usuario_nome
    )
    values (
      p_pendencia_id,
      'titulo_alterado',
      'Anterior: ' || coalesce(v_pendencia.titulo, '(sem titulo)')
        || E'\nNovo: ' || v_titulo,
      (select auth.uid()),
      coalesce(v_usuario_nome, 'Usuario')
    );
  end if;

  if v_pendencia.descricao is distinct from v_descricao then
    insert into public.pendencias_historico(
      pendencia_id, evento, descricao, usuario_id, usuario_nome
    )
    values (
      p_pendencia_id,
      'descricao_alterada',
      'Anterior: ' || v_pendencia.descricao || E'\nNova: ' || v_descricao,
      (select auth.uid()),
      coalesce(v_usuario_nome, 'Usuario')
    );
  end if;
end;
$$;

revoke all on function public.pendencia_editar_conteudo(uuid, text, text) from public, anon;
grant execute on function public.pendencia_editar_conteudo(uuid, text, text) to authenticated;
