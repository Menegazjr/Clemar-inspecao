-- Adiciona o titulo das pendencias criadas a partir de relatorios.
-- Execute no SQL Editor depois de supabase_pendencias_ajustes_v3.sql.

alter table public.pendencias
  add column if not exists titulo text;

grant insert (titulo) on table public.pendencias to authenticated;
