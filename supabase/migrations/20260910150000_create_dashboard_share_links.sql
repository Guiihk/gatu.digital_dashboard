create table if not exists public.dashboard_share_links (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references public.clients(id) on delete cascade,
  token text not null unique check (length(token) >= 43),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dashboard_share_links enable row level security;
revoke all on public.dashboard_share_links from anon, authenticated;

create index if not exists dashboard_share_links_active_token_idx
  on public.dashboard_share_links(token)
  where active = true;
