-- Rode no Supabase: SQL Editor > New query
create table if not exists public.obras_mapa (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cliente text default '',
  cidade text not null,
  uf text default '',
  lat double precision not null,
  lng double precision not null,
  status text default 'Em andamento',
  supervisorio_url text default '',
  observacoes text default '',
  criado_por text,
  criado_em timestamptz default now(),
  atualizado_em timestamptz default now()
);

alter table public.obras_mapa enable row level security;

-- Qualquer pessoa (sem login) pode VER as obras
create policy "mapa_leitura_publica" on public.obras_mapa
  for select to anon, authenticated using (true);

-- Só usuários logados E aprovados (ou admin) podem cadastrar/editar/excluir
create policy "mapa_escrita_aprovados" on public.obras_mapa
  for all to authenticated
  using (exists (select 1 from public.usuarios u where u.id = auth.uid() and (u.aprovado = true or u.role = 'admin')))
  with check (exists (select 1 from public.usuarios u where u.id = auth.uid() and (u.aprovado = true or u.role = 'admin')));
