alter table public.daily_creative_metrics
  add column if not exists reported_sales numeric(18, 6) not null default 0,
  add column if not exists reported_leads numeric(18, 6) not null default 0;

comment on column public.daily_creative_metrics.reported_sales is
  'Purchases or sales reported by the advertising platform for the creative day.';

comment on column public.daily_creative_metrics.reported_leads is
  'Lead outcomes reported by the advertising platform for the creative day.';
