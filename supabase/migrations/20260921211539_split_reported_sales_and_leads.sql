-- Keep platform-reported outcomes separated. The legacy conversions column
-- remains for backwards compatibility with campaign and creative views.
alter table public.daily_campaign_metrics
  add column if not exists reported_sales numeric(18, 6) not null default 0,
  add column if not exists reported_leads numeric(18, 6) not null default 0;

comment on column public.daily_campaign_metrics.reported_sales is
  'Purchases or sales reported by the advertising platform for the campaign day.';

comment on column public.daily_campaign_metrics.reported_leads is
  'Lead outcomes reported by the advertising platform for the campaign day.';
