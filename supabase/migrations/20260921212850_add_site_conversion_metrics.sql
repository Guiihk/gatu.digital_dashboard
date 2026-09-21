alter table public.daily_campaign_metrics
  add column if not exists website_visitors numeric(18, 6) not null default 0,
  add column if not exists google_conversion_rate numeric(18, 12);

comment on column public.daily_campaign_metrics.website_visitors is
  'Meta landing-page views used by the dashboard as site visitors for the requested visitors divided by sales rate.';

comment on column public.daily_campaign_metrics.google_conversion_rate is
  'Google Ads metrics.conversions_from_interactions_rate, stored as a decimal fraction.';
