import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Content-Type':'application/json'};
const projectUrl=Deno.env.get('SUPABASE_URL')!;
const publishableKeys=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')!);
const secretKeys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!);
const authClient=createClient(projectUrl,publishableKeys.default);
const adminClient=createClient(projectUrl,secretKeys.default,{auth:{autoRefreshToken:false,persistSession:false}});
const creativeBucket='creative-assets';
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:corsHeaders});

async function requireAdmin(req:Request){
  const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
  if(!token) throw new Error('Não autenticado.');
  const {data:{user},error}=await authClient.auth.getUser(token);
  if(error||!user) throw new Error('Sessão inválida.');
  const {data:profile}=await adminClient.from('profiles').select('role').eq('id',user.id).maybeSingle();
  if(profile?.role!=='admin') throw new Error('Acesso administrativo necessário.');
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:corsHeaders});
  try{
    const body=await req.json();
    const shareToken=String(body.shareToken||'');
    let slug=String(body.slug||'');
    let sharedClient:null|{id:string,name:string,slug:string}=null;
    if(shareToken){
      const {data:link,error:linkError}=await adminClient.from('dashboard_share_links').select('client_id').eq('token',shareToken).eq('active',true).maybeSingle();
      if(linkError||!link) return reply({error:'Link de acesso inválido.'},403);
      const {data:linkedClient,error:linkedClientError}=await adminClient.from('clients').select('id,name,slug').eq('id',link.client_id).eq('active',true).maybeSingle();
      if(linkedClientError||!linkedClient) return reply({error:'Cliente não encontrado ou inativo.'},404);
      sharedClient=linkedClient;slug=linkedClient.slug;
    }else await requireAdmin(req);
    const startDate=String(body.startDate||'');
    const endDate=String(body.endDate||'');
    if(!slug||!/^\d{4}-\d{2}-\d{2}$/.test(startDate)||!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return reply({error:'Cliente ou período inválido.'},400);
    const startInstant=new Date(`${startDate}T00:00:00Z`),endInstant=new Date(`${endDate}T00:00:00Z`),days=Math.round((endInstant.getTime()-startInstant.getTime())/86400000)+1;
    if(days<1||days>366) return reply({error:'Selecione um período entre 1 e 366 dias.'},400);
    const previousEnd=new Date(startInstant);previousEnd.setUTCDate(previousEnd.getUTCDate()-1);
    const previousStart=new Date(previousEnd);previousStart.setUTCDate(previousStart.getUTCDate()-days+1);
    const previousStartDate=previousStart.toISOString().slice(0,10),previousEndDate=previousEnd.toISOString().slice(0,10);
    const clientResult=sharedClient?{data:sharedClient,error:null}:await adminClient.from('clients').select('id,name,slug').eq('slug',slug).maybeSingle();
    const {data:client,error:clientError}=clientResult;
    if(clientError||!client) return reply({error:'Cliente não encontrado.'},404);
    const {data:integrations,error:integrationError}=await adminClient.from('integrations').select('id,platform,status,ad_accounts(id,currency_code)').eq('client_id',client.id);
    if(integrationError) throw integrationError;
    const accountPlatform=new Map<string,string>();
    for(const integration of integrations||[]) for(const account of integration.ad_accounts||[]) accountPlatform.set(account.id,integration.platform);
    const accountIds=[...accountPlatform.keys()];
    if(!accountIds.length) return reply({client,campaigns:[],daily:[],creatives:[],keywords:[],startDate,endDate});
    const {data:campaignRows,error:campaignError}=await adminClient.from('campaigns').select('id,ad_account_id,external_id,name,status,objective').in('ad_account_id',accountIds);
    if(campaignError) throw campaignError;
    const campaignIds=(campaignRows||[]).map(row=>row.id);
    const {data:metricRows,error:metricError}=campaignIds.length?await adminClient.from('daily_campaign_metrics').select('campaign_id,metric_date,spend,impressions,clicks,conversions,reported_sales,reported_leads,website_visitors,google_conversion_rate,conversion_value').in('campaign_id',campaignIds).gte('metric_date',previousStartDate).lte('metric_date',endDate):{data:[],error:null};
    if(metricError) throw metricError;
    const totals=new Map<string,{spend:number,impressions:number,clicks:number,conversions:number,reportedSales:number,reportedLeads:number,websiteVisitors:number,googleConversionRateWeightedSum:number,googleConversionRateWeight:number,conversionValue:number}>();
    for(const row of (metricRows||[]).filter(row=>row.metric_date>=startDate)){
      const current=totals.get(row.campaign_id)||{spend:0,impressions:0,clicks:0,conversions:0,reportedSales:0,reportedLeads:0,websiteVisitors:0,googleConversionRateWeightedSum:0,googleConversionRateWeight:0,conversionValue:0};
      const clicks=Number(row.clicks||0),googleConversionRate=Number(row.google_conversion_rate||0);current.spend+=Number(row.spend||0);current.impressions+=Number(row.impressions||0);current.clicks+=clicks;current.conversions+=Number(row.conversions||0);current.reportedSales+=Number(row.reported_sales||0);current.reportedLeads+=Number(row.reported_leads||0);current.websiteVisitors+=Number(row.website_visitors||0);current.googleConversionRateWeightedSum+=googleConversionRate*clicks;current.googleConversionRateWeight+=clicks;current.conversionValue+=Number(row.conversion_value||0);
      totals.set(row.campaign_id,current);
    }
    const withGoogleRate=(row:Record<string,unknown>)=>({...row,googleConversionRate:Number(row.googleConversionRateWeight||0)?Number(row.googleConversionRateWeightedSum||0)/Number(row.googleConversionRateWeight):null});
    const emptyTotals={spend:0,impressions:0,clicks:0,conversions:0,reportedSales:0,reportedLeads:0,websiteVisitors:0,googleConversionRateWeightedSum:0,googleConversionRateWeight:0,conversionValue:0};
    const campaigns=(campaignRows||[]).map(row=>withGoogleRate({id:row.id,externalId:row.external_id,platform:accountPlatform.get(row.ad_account_id)==='meta_ads'?'meta':'google',name:row.name,type:row.objective||'Campanha',status:row.status||'UNKNOWN',...(totals.get(row.id)||emptyTotals)})).filter(row=>Number(row.spend)||Number(row.impressions)||Number(row.clicks)||Number(row.conversions)||Number(row.conversionValue));
    const previousTotals=new Map<string,typeof emptyTotals>();
    for(const row of (metricRows||[]).filter(row=>row.metric_date>=previousStartDate&&row.metric_date<=previousEndDate)){const current=previousTotals.get(row.campaign_id)||{...emptyTotals};const clicks=Number(row.clicks||0),googleConversionRate=Number(row.google_conversion_rate||0);current.spend+=Number(row.spend||0);current.impressions+=Number(row.impressions||0);current.clicks+=clicks;current.conversions+=Number(row.conversions||0);current.reportedSales+=Number(row.reported_sales||0);current.reportedLeads+=Number(row.reported_leads||0);current.websiteVisitors+=Number(row.website_visitors||0);current.googleConversionRateWeightedSum+=googleConversionRate*clicks;current.googleConversionRateWeight+=clicks;current.conversionValue+=Number(row.conversion_value||0);previousTotals.set(row.campaign_id,current)}
    const previousCampaigns=(campaignRows||[]).map(row=>withGoogleRate({id:row.id,platformId:row.external_id,platform:accountPlatform.get(row.ad_account_id)==='meta_ads'?'meta':'google',name:row.name,type:row.objective||'Campanha',status:row.status||'UNKNOWN',...(previousTotals.get(row.id)||emptyTotals)}));
    const campaignPlatform=new Map(campaigns.map(row=>[row.id,row.platform]));
    const daily=(metricRows||[]).filter(row=>row.metric_date>=startDate).map(row=>({campaignId:row.campaign_id,platform:campaignPlatform.get(row.campaign_id),date:row.metric_date,spend:Number(row.spend||0),impressions:Number(row.impressions||0),clicks:Number(row.clicks||0),conversions:Number(row.conversions||0),reportedSales:Number(row.reported_sales||0),reportedLeads:Number(row.reported_leads||0),websiteVisitors:Number(row.website_visitors||0),googleConversionRate:row.google_conversion_rate===null?null:Number(row.google_conversion_rate||0),conversionValue:Number(row.conversion_value||0)})).filter(row=>row.platform);
    const {data:creativeRows,error:creativeError}=campaignIds.length?await adminClient.from('creatives').select('id,campaign_id,name,media_type,preview_url,thumbnail_url,metadata').in('campaign_id',campaignIds):{data:[],error:null};
    if(creativeError) throw creativeError;
    const creativeIds=(creativeRows||[]).map(row=>row.id);
    const {data:creativeMetricRows,error:creativeMetricError}=creativeIds.length?await adminClient.from('daily_creative_metrics').select('creative_id,spend,conversions').in('creative_id',creativeIds).gte('metric_date',startDate).lte('metric_date',endDate):{data:[],error:null};
    if(creativeMetricError) throw creativeMetricError;
    const creativeTotals=new Map<string,{spend:number,conversions:number}>();
    for(const row of creativeMetricRows||[]){const total=creativeTotals.get(row.creative_id)||{spend:0,conversions:0};total.spend+=Number(row.spend||0);total.conversions+=Number(row.conversions||0);creativeTotals.set(row.creative_id,total)}
    const campaignById=new Map((campaignRows||[]).map(row=>[row.id,row]));
    const creatives=(await Promise.all((creativeRows||[]).map(async row=>{
      const campaign=campaignById.get(row.campaign_id),metadata=row.metadata as Record<string,unknown> | null,ad=metadata?.ad as Record<string,unknown> | undefined;
      const assetPath=typeof metadata?.asset_path==='string'?metadata.asset_path:null;
      let storedPreview:string|null=null;
      if(assetPath){const {data}=await adminClient.storage.from(creativeBucket).createSignedUrl(assetPath,3600);storedPreview=data?.signedUrl||null}
      return {id:row.id,platform:campaign?accountPlatform.get(campaign.ad_account_id)==='meta_ads'?'meta':'google':'meta',name:row.name,adName:typeof ad?.name==='string'?ad.name:null,mediaType:row.media_type,previewUrl:storedPreview||row.preview_url,thumbnailUrl:row.thumbnail_url,campaignName:campaign?.name,...(creativeTotals.get(row.id)||{spend:0,conversions:0})}
    }))).filter(row=>row.spend||row.conversions);
    const googleAccountIds=[...accountPlatform.entries()].filter(([,source])=>source==='google_ads').map(([id])=>id);
    const {data:keywordRows,error:keywordError}=googleAccountIds.length?await adminClient.from('google_ads_keywords').select('id,keyword_text,match_type,ad_group_name,campaigns(name)').in('ad_account_id',googleAccountIds):{data:[],error:null};
    if(keywordError)throw keywordError;
    const keywordIds=(keywordRows||[]).map(row=>row.id);
    const {data:keywordMetricRows,error:keywordMetricError}=keywordIds.length?await adminClient.from('daily_keyword_metrics').select('keyword_id,spend,impressions,clicks,conversions').in('keyword_id',keywordIds).gte('metric_date',startDate).lte('metric_date',endDate):{data:[],error:null};
    if(keywordMetricError)throw keywordMetricError;
    const keywordTotals=new Map<string,{spend:number,impressions:number,clicks:number,conversions:number}>();
    for(const row of keywordMetricRows||[]){const total=keywordTotals.get(row.keyword_id)||{spend:0,impressions:0,clicks:0,conversions:0};total.spend+=Number(row.spend||0);total.impressions+=Number(row.impressions||0);total.clicks+=Number(row.clicks||0);total.conversions+=Number(row.conversions||0);keywordTotals.set(row.keyword_id,total)}
    const keywords=(keywordRows||[]).map(row=>({id:row.id,text:row.keyword_text,matchType:row.match_type,adGroupName:row.ad_group_name,campaignName:Array.isArray(row.campaigns)?row.campaigns[0]?.name:row.campaigns?.name,...(keywordTotals.get(row.id)||{spend:0,impressions:0,clicks:0,conversions:0})})).filter(row=>row.spend||row.impressions||row.clicks||row.conversions).sort((a,b)=>b.spend-a.spend);
    return reply({client,campaigns,previousCampaigns,daily,creatives,keywords,startDate,endDate,previousStartDate,previousEndDate});
  }catch(error){return reply({error:error instanceof Error?error.message:'Erro inesperado.'},400);}
});
