-- Rode no Supabase (SQL Editor) ANTES de subir o novo mapa.html
alter table public.obras_mapa add column if not exists cor text default '';
