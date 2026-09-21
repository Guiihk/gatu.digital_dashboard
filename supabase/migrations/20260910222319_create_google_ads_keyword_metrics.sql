create table if not exists public.google_ads_keywords (
  id uuid primary key default gen_random_uuid(),
  ad_account_id uuid not null references public.ad_accounts(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  external_id text not null,
  ad_group_external_id text,
  ad_group_name text,
  keyword_text text not null,
  match_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ad_account_id, external_id)
);

create table if not exists public.daily_keyword_metrics (
  id uuid primary key default gen_random_uuid(),
  keyword_id uuid not null references public.google_ads_keywords(id) on delete cascade,
  metric_date date not null,
  spend numeric(18, 6) not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  conversions numeric(18, 6) not null default 0,
  currency_code text not null default 'BRL',
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (keyword_id, metric_date)
);

create index if not exists google_ads_keywords_campaign_id_idx
  on public.google_ads_keywords(campaign_id);

create index if not exists daily_keyword_metrics_metric_date_idx
  on public.daily_keyword_metrics(metric_date);

alter table public.google_ads_keywords enable row level security;
alter table public.daily_keyword_metrics enable row level security;

revoke all on public.google_ads_keywords from anon, authenticated;
revoke all on public.daily_keyword_metrics from anon, authenticated;
