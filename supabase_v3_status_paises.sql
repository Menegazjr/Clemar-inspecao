-- Rode no Supabase (SQL Editor) ANTES de subir o novo mapa.html
alter table public.obras_mapa add column if not exists manutencao boolean default false;
alter table public.obras_mapa add column if not exists pais text default '';
update public.obras_mapa set status = 'Paralisada' where status = 'Parada';
