-- Execute no Supabase SQL Editor antes de publicar o novo mapa.
alter table public.obras_mapa
  add column if not exists supervisorio_monitorar boolean not null default false,
  add column if not exists supervisorio_status text,
  add column if not exists supervisorio_verificado_em timestamptz;
