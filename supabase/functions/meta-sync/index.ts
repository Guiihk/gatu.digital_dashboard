import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json'
};

const projectUrl = Deno.env.get('SUPABASE_URL')!;
const publishableKeys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')!);
const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!);
const authClient = createClient(projectUrl, publishableKeys.default);
const adminClient = createClient(projectUrl, secretKeys.default, {auth: {autoRefreshToken: false, persistSession: false}});
const graphVersion = Deno.env.get('META_GRAPH_VERSION') || 'v26.0';
const creativeBucket = 'creative-assets';
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: corsHeaders});

async function requireAccess(req: Request, body: Record<string, unknown>) {
  const shareToken=typeof body.shareToken==='string'?body.shareToken:'';
  if(shareToken){
    const {data:link,error}=await adminClient.from('dashboard_share_links').select('client_id').eq('token',shareToken).eq('active',true).maybeSingle();
    if(error||!link)throw new Error('Link de acesso inválido.');
    return {scheduled:false,clientId:link.client_id};
  }
  const cronSecret = req.headers.get('x-cron-secret');
  if (cronSecret) {
    const {data: expected, error} = await adminClient.rpc('get_meta_sync_cron_secret');
    if (error || !expected || cronSecret !== expected) throw new Error('Agendamento não autorizado.');
    return {scheduled: true};
  }
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new Error('Não autenticado.');
  const {data: {user}, error} = await authClient.auth.getUser(token);
  if (error || !user) throw new Error('Sessão inválida.');
  const {data: profile} = await adminClient.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (profile?.role !== 'admin') throw new Error('Acesso administrativo necessário.');
  return {scheduled: false};
}

async function graph(path: string, params: Record<string, string>, accessToken: string) {
  const records: Record<string, unknown>[] = [];
  let url: URL | null = new URL(`https://graph.facebook.com/${graphVersion}/${path}`);
  Object.entries(params).forEach(([key, value]) => url!.searchParams.set(key, value));
  while (url) {
    url.searchParams.delete('access_token');
    const response = await fetch(url, {headers: {Authorization: `Bearer ${accessToken}`}});
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error?.message || 'Falha ao consultar a Meta API.');
    records.push(...(payload.data || []));
    url = payload.paging?.next ? new URL(payload.paging.next) : null;
  }
  return records;
}

const metaLeadActionTypes = new Set([
  'lead',
  'onsite_conversion.lead_grouped',
  'onsite_conversion.messaging_conversation_started_7d',
  'offsite_conversion.fb_pixel_lead',
  'offsite_conversion.fb_pixel_complete_registration'
]);
const metaSaleActionTypes = new Set([
  'purchase',
  'omni_purchase',
  'onsite_conversion.purchase',
  'offsite_conversion.fb_pixel_purchase'
]);

function actionTotal(actions: unknown, actionTypes: Set<string>) {
  const values = Array.isArray(actions) ? actions as Record<string, unknown>[] : [];
  return values.reduce((total, item) => actionTypes.has(String(item.action_type || '')) ? total + Number(item.value || 0) : total, 0);
}

function reportedOutcomes(actions: unknown) {
  const sales = actionTotal(actions, metaSaleActionTypes);
  const leads = actionTotal(actions, metaLeadActionTypes);
  return {sales, leads, conversions: sales + leads};
}

function selectedAction(actions: unknown) {
  const outcomes = reportedOutcomes(actions);
  return {type: 'reported', value: outcomes.conversions};
}

function isoDate(value: unknown, fallback: string) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : fallback;
}

function todayInSaoPaulo() {
  const parts = new Intl.DateTimeFormat('en-US', {timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function creativeImageHash(creative: Record<string, unknown> | undefined) {
  const story = creative?.object_story_spec as Record<string, unknown> | undefined;
  const linkData = story?.link_data as Record<string, unknown> | undefined;
  if (typeof linkData?.image_hash === 'string') return linkData.image_hash;
  const attachments = linkData?.child_attachments;
  if (Array.isArray(attachments) && typeof (attachments[0] as Record<string, unknown> | undefined)?.image_hash === 'string') return (attachments[0] as Record<string, unknown>).image_hash as string;
  const assetFeed = creative?.asset_feed_spec as Record<string, unknown> | undefined;
  const images = assetFeed?.images;
  if (Array.isArray(images) && typeof (images[0] as Record<string, unknown> | undefined)?.hash === 'string') return (images[0] as Record<string, unknown>).hash as string;
  return null;
}

function creativeVideoId(creative: Record<string, unknown> | undefined) {
  if (typeof creative?.video_id === 'string') return creative.video_id;
  const story = creative?.object_story_spec as Record<string, unknown> | undefined;
  const videoData = story?.video_data as Record<string, unknown> | undefined;
  if (typeof videoData?.video_id === 'string') return videoData.video_id;
  const linkData = story?.link_data as Record<string, unknown> | undefined;
  const attachments = linkData?.child_attachments;
  if (Array.isArray(attachments)) {
    const videoAttachment = attachments.find(item => typeof (item as Record<string, unknown>)?.video_id === 'string') as Record<string, unknown> | undefined;
    if (typeof videoAttachment?.video_id === 'string') return videoAttachment.video_id;
  }
  const assetFeed = creative?.asset_feed_spec as Record<string, unknown> | undefined;
  const videos = assetFeed?.videos;
  if (Array.isArray(videos) && typeof (videos[0] as Record<string, unknown> | undefined)?.video_id === 'string') return (videos[0] as Record<string, unknown>).video_id as string;
  return null;
}

function previewVideoCover(previews: Record<string, unknown>[]) {
  for (const preview of previews) {
    const body = typeof preview.body === 'string' ? preview.body : '';
    const tag = body.match(/<img\b[^>]*\bdata-(?:react-)?ad-preview=["']video-cover["'][^>]*>/i)?.[0];
    const source = tag?.match(/\bsrc=["']([^"']+)["']/i)?.[1];
    if (source?.startsWith('https://')) return source.replaceAll('&amp;', '&').replaceAll('&#x2F;', '/');
  }
  return null;
}

function attachmentImage(attachments: Record<string, unknown>[]) {
  const visit = (attachment: Record<string, unknown>): string | null => {
    const media = attachment.media as Record<string, unknown> | undefined;
    const image = media?.image as Record<string, unknown> | undefined;
    if (typeof image?.src === 'string' && image.src.startsWith('https://')) return image.src;
    const nested = attachment.subattachments as Record<string, unknown> | undefined;
    const children = Array.isArray(nested?.data) ? nested.data as Record<string, unknown>[] : [];
    for (const child of children) { const source = visit(child); if (source) return source; }
    return null;
  };
  for (const attachment of attachments) { const source = visit(attachment); if (source) return source; }
  return null;
}

async function ensureCreativeBucket() {
  const {data} = await adminClient.storage.getBucket(creativeBucket);
  if (data) return;
  const {error} = await adminClient.storage.createBucket(creativeBucket, {
    public: false,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    fileSizeLimit: '15MB'
  });
  if (error && !/already exists/i.test(error.message)) throw error;
}

function originalImageCandidates(source: string) {
  const candidates: string[] = [];
  try {
    const url = new URL(source);
    if (/\.fbcdn\.net$/i.test(url.hostname) || /\.xx\.fbcdn\.net$/i.test(url.hostname)) {
      const original = new URL(url);
      original.searchParams.delete('stp');
      candidates.push(original.href);
    }
  } catch { /* The validated fallback below will handle malformed values. */ }
  candidates.push(source);
  return [...new Set(candidates.filter(value => value.startsWith('https://')))];
}

async function storeCreativeImage(clientId: string, adId: string, source: string | null) {
  if (!source) return null;
  for (const candidate of originalImageCandidates(source)) {
    try {
      const response = await fetch(candidate, {headers: {'User-Agent': 'Mozilla/5.0'}});
      const contentType = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
      if (!response.ok || !['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) continue;
      const file = await response.arrayBuffer();
      if (!file.byteLength) continue;
      const extension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
      const path = `${clientId}/meta/${adId}.${extension}`;
      const {error} = await adminClient.storage.from(creativeBucket).upload(path, file, {
        contentType,
        cacheControl: '31536000',
        upsert: true
      });
      if (error) throw error;
      return path;
    } catch (error) {
      console.warn(`Não foi possível armazenar a imagem do anúncio ${adId}.`, error);
    }
  }
  return null;
}

async function synchronize(clientId: string, startDate: string, endDate: string) {
  const {data: integration, error: integrationError} = await adminClient
    .from('integrations')
    .select('id,external_account_id,ad_accounts(id,currency_code)')
    .eq('client_id', clientId)
    .eq('platform', 'meta_ads')
    .maybeSingle();
  if (integrationError || !integration) throw new Error(integrationError?.message || 'Integração Meta não encontrada.');
  if (!integration.external_account_id) throw new Error('A conta de anúncios Meta não foi informada.');

  const {data: accessToken, error: credentialError} = await adminClient.rpc('get_integration_credential', {p_integration_id: integration.id});
  if (credentialError || !accessToken) throw new Error('O token Meta não está disponível no Vault.');

  const {data: run, error: runError} = await adminClient.from('sync_runs').insert({integration_id: integration.id, status: 'running', started_at: new Date().toISOString()}).select('id').single();
  if (runError || !run) throw new Error(runError?.message || 'Não foi possível iniciar a sincronização.');

  try {
    const accountId = String(integration.external_account_id);
    const [campaignRows, insightRows] = await Promise.all([
      graph(`${accountId}/campaigns`, {fields: 'id,name,status,effective_status,objective,start_time,stop_time', limit: '500'}, accessToken),
      graph(`${accountId}/insights`, {
        level: 'campaign',
        time_increment: '1',
        time_range: JSON.stringify({since: startDate, until: endDate}),
        fields: 'campaign_id,campaign_name,spend,impressions,clicks,inline_link_clicks,actions,action_values,date_start,date_stop',
        limit: '500'
      }, accessToken)
    ]);

    const known = new Map(campaignRows.map(row => [String(row.id), row]));
    insightRows.forEach(row => {
      const id = String(row.campaign_id || '');
      if (id && !known.has(id)) known.set(id, {id, name: row.campaign_name || id});
    });

    const adAccount = Array.isArray(integration.ad_accounts) ? integration.ad_accounts[0] : integration.ad_accounts;
    if (!adAccount?.id) throw new Error('Conta Meta validada não encontrada no banco.');
    const campaignPayload = [...known.values()].map(row => ({
      ad_account_id: adAccount.id,
      external_id: String(row.id),
      name: String(row.name || row.id),
      status: row.effective_status ? String(row.effective_status) : row.status ? String(row.status) : null,
      objective: row.objective ? String(row.objective) : null,
      starts_at: row.start_time || null,
      ends_at: row.stop_time || null,
      raw_data: row,
      updated_at: new Date().toISOString()
    }));
    const {data: savedCampaigns, error: campaignsError} = await adminClient.from('campaigns').upsert(campaignPayload, {onConflict: 'ad_account_id,external_id'}).select('id,external_id');
    if (campaignsError || !savedCampaigns) throw new Error(campaignsError?.message || 'Não foi possível salvar as campanhas.');
    const localIds = new Map(savedCampaigns.map(row => [String(row.external_id), row.id]));

    const metricPayload = insightRows.map(row => {
      const outcomes = reportedOutcomes(row.actions);
      return {
        campaign_id: localIds.get(String(row.campaign_id)),
        metric_date: isoDate(row.date_start, startDate),
        spend: Number(row.spend || 0),
        impressions: Number(row.impressions || 0),
        clicks: Number(row.inline_link_clicks || row.clicks || 0),
        conversions: outcomes.conversions,
        reported_sales: outcomes.sales,
        reported_leads: outcomes.leads,
        website_visitors: actionTotal(row.actions, new Set(['landing_page_view'])),
        conversion_value: actionTotal(row.action_values, metaSaleActionTypes),
        currency_code: String(adAccount.currency_code || 'BRL'),
        source_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    }).filter(row => row.campaign_id);
    if (metricPayload.length) {
      const {error: metricsError} = await adminClient.from('daily_campaign_metrics').upsert(metricPayload, {onConflict: 'campaign_id,metric_date'});
      if (metricsError) throw new Error(metricsError.message);
    }

    let creativeMetrics = 0;
    let creativeAssets = 0;
    let creativeWarning: string | null = null;
    try {
      await ensureCreativeBucket();
      const [adRows, adInsightRows] = await Promise.all([
        graph(`${accountId}/ads`, {fields: 'id,name,campaign_id,creative{id,name,video_id,image_url,thumbnail_url,effective_object_story_id,object_story_id,object_story_spec,asset_feed_spec}', limit: '100'}, accessToken),
        graph(`${accountId}/insights`, {
          level: 'ad',
          time_increment: '1',
          time_range: JSON.stringify({since: startDate, until: endDate}),
          fields: 'ad_id,ad_name,campaign_id,spend,impressions,clicks,inline_link_clicks,actions,action_values,date_start,date_stop',
          limit: '500'
        }, accessToken)
      ]);
      const ads = new Map(adRows.map(row => [String(row.id), row]));
      adInsightRows.forEach(row => {
        const id = String(row.ad_id || '');
        if (id && !ads.has(id)) ads.set(id, {id, name: row.ad_name || id, campaign_id: row.campaign_id});
      });
      const imageHashes=[...new Set([...ads.values()].map(row=>creativeImageHash(row.creative as Record<string, unknown> | undefined)).filter((hash): hash is string=>Boolean(hash)))];
      const imageRows=imageHashes.length?await graph(`${accountId}/adimages`, {fields:'hash,url,width,height',hashes:JSON.stringify(imageHashes),limit:'500'}, accessToken):[];
      const imageByHash=new Map(imageRows.map(row=>[String(row.hash),typeof row.url==='string'?row.url:null]));
      const adConversions=new Map<string,number>();
      adInsightRows.forEach(row=>adConversions.set(String(row.ad_id), (adConversions.get(String(row.ad_id)) || 0) + selectedAction(row.actions).value));
      const topVideoAds=[...ads.entries()].map(([adId,row])=>({adId,videoId:creativeVideoId(row.creative as Record<string,unknown> | undefined),conversions:adConversions.get(adId)||0})).filter((row):row is {adId:string,videoId:string,conversions:number}=>typeof row.videoId==='string').sort((a,b)=>b.conversions-a.conversions).slice(0,20);
      const previewCoverResults=await Promise.allSettled(topVideoAds.map(async row=>{
        // Meta falls back to a 64px image when no dimensions are requested.
        // Request a feed-sized preview so the extracted `video-cover` is suitable for the dashboard cards.
        const previews=await graph(`${row.adId}/previews`, {ad_format:'DESKTOP_FEED_STANDARD',width:'1200',height:'1500'}, accessToken);
        return [row.adId,previewVideoCover(previews)] as const
      }));
      const previewCoverByAd=new Map<string,string>();
      for(const result of previewCoverResults) if(result.status==='fulfilled'&&result.value[1]) previewCoverByAd.set(result.value[0],result.value[1]);
      const storyImageResults=await Promise.allSettled([...ads.entries()].map(async ([adId,row])=>{
        const creative=row.creative as Record<string,unknown> | undefined;
        const storyId=creative?.effective_object_story_id || creative?.object_story_id;
        if(typeof storyId!=='string') return [adId,null] as const;
        const attachments=await graph(`${storyId}/attachments`, {fields:'media{image},subattachments{media{image}}'}, accessToken);
        return [adId,attachmentImage(attachments)] as const;
      }));
      const storyImageByAd=new Map<string,string>();
      for(const result of storyImageResults) if(result.status==='fulfilled'&&result.value[1]) storyImageByAd.set(result.value[0],result.value[1]);
      const videoThumbnailResults=await Promise.allSettled(topVideoAds.map(async row=>{
        const thumbnails=await graph(`${row.videoId}/thumbnails`, {fields:'uri,width,height,is_preferred',width:'1200',height:'1200',limit:'25'}, accessToken);
        const best=[...thumbnails].sort((a,b)=>Number(b.width||0)*Number(b.height||0)-Number(a.width||0)*Number(a.height||0))[0];
        return [row.adId,typeof best?.uri==='string'?best.uri:null] as const
      }));
      const videoPreviewByAd=new Map<string,string>();
      for(const result of videoThumbnailResults) if(result.status==='fulfilled'&&result.value[1]) videoPreviewByAd.set(result.value[0],result.value[1]);
      const rankedAdIds = new Set([...adConversions.entries()].sort((a,b)=>b[1]-a[1]).slice(0,20).map(([adId])=>adId));
      const creativePayload = (await Promise.all([...ads.values()].map(async row => {
        const creative = row.creative as Record<string, unknown> | undefined;
        const imageUrl=imageByHash.get(creativeImageHash(creative) || '');
        const previewUrl=storyImageByAd.get(String(row.id)) || videoPreviewByAd.get(String(row.id)) || previewCoverByAd.get(String(row.id)) || imageUrl || (typeof creative?.image_url === 'string' ? creative.image_url : typeof creative?.thumbnail_url === 'string' ? creative.thumbnail_url : null);
        const assetPath=rankedAdIds.has(String(row.id)) ? await storeCreativeImage(clientId, String(row.id), previewUrl) : null;
        if(assetPath) creativeAssets++;
        return {
          campaign_id: localIds.get(String(row.campaign_id)),
          external_id: String(row.id),
          name: String(creative?.name || row.name || row.id),
          media_type: 'Meta Ads',
          // A published post attachment supplies the native rendered image; then fall back to the video thumbnail and preview cover.
          preview_url: previewUrl,
          thumbnail_url: typeof creative?.thumbnail_url === 'string' ? creative.thumbnail_url : null,
          metadata: {ad: row, creative: creative || null, asset_path: assetPath},
          updated_at: new Date().toISOString()
        };
      }))).filter(row => row.campaign_id);
      if (creativePayload.length) {
        const {data: savedCreatives, error: creativesError} = await adminClient.from('creatives').upsert(creativePayload, {onConflict: 'campaign_id,external_id'}).select('id,campaign_id,external_id');
        if (creativesError || !savedCreatives) throw new Error(creativesError?.message || 'Não foi possível salvar os criativos.');
        const localCreativeIds = new Map(savedCreatives.map(row => [`${row.campaign_id}:${row.external_id}`, row.id]));
        const creativeMetricPayload = adInsightRows.map(row => {
          const outcomes = reportedOutcomes(row.actions);
          const campaignId = localIds.get(String(row.campaign_id));
          return {
            creative_id: campaignId ? localCreativeIds.get(`${campaignId}:${String(row.ad_id)}`) : undefined,
            metric_date: isoDate(row.date_start, startDate),
            spend: Number(row.spend || 0),
            impressions: Number(row.impressions || 0),
            clicks: Number(row.inline_link_clicks || row.clicks || 0),
            conversions: outcomes.conversions,
            conversion_value: actionTotal(row.action_values, metaSaleActionTypes),
            currency_code: String(adAccount.currency_code || 'BRL'),
            source_updated_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };
        }).filter(row => row.creative_id);
        if (creativeMetricPayload.length) {
          const {error: creativeMetricsError} = await adminClient.from('daily_creative_metrics').upsert(creativeMetricPayload, {onConflict: 'creative_id,metric_date'});
          if (creativeMetricsError) throw new Error(creativeMetricsError.message);
          creativeMetrics = creativeMetricPayload.length;
        }
      }
    } catch (error) {
      creativeWarning = error instanceof Error ? error.message : 'Erro inesperado ao sincronizar criativos.';
      console.warn('A sincronização de criativos não foi concluída.', error);
    }

    await adminClient.from('sync_runs').update({status: 'succeeded', finished_at: new Date().toISOString(), records_processed: metricPayload.length + creativeMetrics}).eq('id', run.id);
    await adminClient.from('integrations').update({status: 'connected', last_verified_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString()}).eq('id', integration.id);
    return {campaigns: savedCampaigns.length, dailyMetrics: metricPayload.length, creativeMetrics, creativeAssets, creativeWarning, startDate, endDate};
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro inesperado na sincronização.';
    await adminClient.from('sync_runs').update({status: 'failed', finished_at: new Date().toISOString(), error_message: message}).eq('id', run.id);
    await adminClient.from('integrations').update({status: 'error', last_error: message, updated_at: new Date().toISOString()}).eq('id', integration.id);
    throw error;
  }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: corsHeaders});
  try {
    const body = await req.json() as Record<string, unknown>;
    const access = await requireAccess(req, body);
    const endDate = isoDate(body.endDate, todayInSaoPaulo());
    const start = new Date(`${endDate}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - 59);
    const startDate = isoDate(body.startDate, start.toISOString().slice(0, 10));
    if (body.scheduled === true) {
      if (!access.scheduled) return reply({error: 'Requisição de agendamento inválida.'}, 403);
      const {data: integrations, error} = await adminClient.from('integrations').select('client_id').eq('platform', 'meta_ads').in('status', ['connected','error']).not('credential_secret_id', 'is', null);
      if (error) throw error;
      const results = [];
      for (const integration of integrations || []) {
        try { results.push({clientId: integration.client_id, ok: true, result: await synchronize(integration.client_id, startDate, endDate)}); }
        catch (error) { results.push({clientId: integration.client_id, ok: false, error: error instanceof Error ? error.message : 'Erro inesperado.'}); }
      }
      return reply({scheduled: true, results});
    }
    const clientId=access.clientId||body.clientId;
    if (typeof clientId !== 'string') return reply({error: 'Cliente inválido.'}, 400);
    return reply({result: await synchronize(clientId, startDate, endDate)});
  } catch (error) {
    return reply({error: error instanceof Error ? error.message : 'Erro inesperado.'}, 400);
  }
});
