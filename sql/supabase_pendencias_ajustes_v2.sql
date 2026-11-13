-- Ajustes do módulo de pendências: fotos de abertura, remoção pelo relatório e retirada de prioridade.
-- Execute uma única vez no SQL Editor do Supabase.

alter table public.pendencias
  add column if not exists fotos jsonb not null default '[]'::jsonb;

alter table public.pendencias drop column if exists prioridade;

revoke insert on table public.pendencias from authenticated;
grant insert (id, obra_mapa_id, relatorio_id, descricao, prazo, fotos) on table public.pendencias to authenticated;
grant delete on table public.pendencias to authenticated;

drop policy if exists pendencias_relatorio_apaga on public.pendencias;
create policy pendencias_relatorio_apaga on public.pendencias
for delete to authenticated
using (
  public.clemar_usuario_aprovado()
  and (
    public.clemar_e_supervisor()
    or criado_por = auth.uid()
    or exists (
      select 1 from public.relatorios r
      where r.id = pendencias.relatorio_id and r.user_id = auth.uid()
    )
  )
);
