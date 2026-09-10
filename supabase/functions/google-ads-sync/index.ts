import {createClient} from 'npm:@supabase/supabase-js@2';

const corsHeaders={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-cron-secret','Content-Type':'application/json'};
const projectUrl=Deno.env.get('SUPABASE_URL')!;
const publishableKeys=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')!);
const secretKeys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!);
const oauthClientId=Deno.env.get('GOOGLE_ADS_CLIENT_ID')!;
const oauthClientSecret=Deno.env.get('GOOGLE_ADS_CLIENT_SECRET')!;
const developerToken=Deno.env.get('GOOGLE_ADS_DEVELOPER_TOKEN')!;
const apiVersion=Deno.env.get('GOOGLE_ADS_API_VERSION')||'v25';
const authClient=createClient(projectUrl,publishableKeys.default);
const adminClient=createClient(projectUrl,secretKeys.default,{auth:{autoRefreshToken:false,persistSession:false}});
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:corsHeaders});
const digits=(value:unknown)=>String(value||'').replace(/\D/g,'');

function todayInSaoPaulo(){const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));return `${values.year}-${values.month}-${values.day}`}
function isoDate(value:unknown,fallback:string){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value:fallback}

async function requireAccess(req:Request,body:Record<string,unknown>){
  const shareToken=typeof body.shareToken==='string'?body.shareToken:'';
  if(shareToken){
    const {data:link,error}=await adminClient.from('dashboard_share_links').select('client_id').eq('token',shareToken).eq('active',true).maybeSingle();
    if(error||!link)throw new Error('Link de acesso inválido.');
    return {scheduled:false,clientId:link.client_id};
  }
  const cronSecret=req.headers.get('x-cron-secret');
  if(cronSecret){const {data:expected,error}=await adminClient.rpc('get_meta_sync_cron_secret');if(error||!expected||cronSecret!==expected)throw new Error('Agendamento não autorizado.');return {scheduled:true}}
  const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
  if(!token)throw new Error('Não autenticado.');
  const {data:{user},error}=await authClient.auth.getUser(token);
  if(error||!user)throw new Error('Sessão inválida.');
  const {data:profile}=await adminClient.from('profiles').select('role').eq('id',user.id).maybeSingle();
  if(profile?.role!=='admin')throw new Error('Acesso administrativo necessário.');
  return {scheduled:false};
}

async function accessToken(refreshToken:string){
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:oauthClientId,client_secret:oauthClientSecret,refresh_token:refreshToken,grant_type:'refresh_token'})});
  const data=await response.json();
  if(!response.ok||!data.access_token)throw new Error(data.error_description||'Não foi possível renovar o acesso ao Google Ads.');
  return String(data.access_token);
}

async function googleSearch(customerId:string,managerId:string,token:string,query:string){
  const headers:Record<string,string>={'Authorization':`Bearer ${token}`,'developer-token':developerToken,'Content-Type':'application/json'};
  if(managerId)headers['login-customer-id']=managerId;
  const response=await fetch(`https://googleads.googleapis.com/${apiVersion}/customers/${customerId}/googleAds:searchStream`,{method:'POST',headers,body:JSON.stringify({query})});
  const data=await response.json();
  if(!response.ok){const payload=Array.isArray(data)?data.find(item=>item?.error)||data[0]:data;const details=(payload?.error?.details||[]).flatMap((item:{errors?:Array<{message?:string;errorCode?:Record<string,string>;error_code?:Record<string,string>}>})=>item.errors||[]).map((item:{message?:string;errorCode?:Record<string,string>;error_code?:Record<string,string>})=>{const code=Object.values(item.errorCode||item.error_code||{}).filter(Boolean).join('/');return [code,item.message].filter(Boolean).join(': ')}).filter(Boolean).join(' | ');const requestId=response.headers.get('request-id');throw new Error([payload?.error?.status,payload?.error?.message,details,requestId?`Request ID: ${requestId}`:''].filter(Boolean).join(' — ')||`Google Ads API respondeu com HTTP ${response.status}.`)}
  return (Array.isArray(data)?data:[]).flatMap(chunk=>Array.isArray(chunk.results)?chunk.results:[]);
}

async function synchronize(clientId:string,startDate:string,endDate:string){
  const {data:integration,error:integrationError}=await adminClient.from('integrations').select('id,external_account_id,manager_account_id,ad_accounts(id,currency_code)').eq('client_id',clientId).eq('platform','google_ads').maybeSingle();
  if(integrationError||!integration)throw new Error(integrationError?.message||'Integração Google Ads não encontrada.');
  const customerId=digits(integration.external_account_id),managerId=digits(integration.manager_account_id);
  if(!/^\d{10}$/.test(customerId))throw new Error('O ID do cliente Google Ads deve conter 10 dígitos.');
  const {data:refreshToken,error:credentialError}=await adminClient.rpc('get_integration_credential',{p_integration_id:integration.id});
  if(credentialError||!refreshToken)throw new Error('O refresh token do Google Ads não está disponível no Vault.');
  const {data:run,error:runError}=await adminClient.from('sync_runs').insert({integration_id:integration.id,status:'running',started_at:new Date().toISOString()}).select('id').single();
  if(runError||!run)throw new Error(runError?.message||'Não foi possível iniciar a sincronização.');
  try{
    const token=await accessToken(String(refreshToken));
    const rows=await googleSearch(customerId,managerId,token,`SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${startDate}' AND '${endDate}' AND campaign.status != 'REMOVED' ORDER BY segments.date`);
    const account=Array.isArray(integration.ad_accounts)?integration.ad_accounts[0]:integration.ad_accounts;
    if(!account?.id)throw new Error('Conta Google Ads validada não encontrada no banco.');
    const known=new Map<string,Record<string,unknown>>();
    rows.forEach(row=>{const campaign=row.campaign as Record<string,unknown>|undefined;if(campaign?.id)known.set(String(campaign.id),campaign)});
    const campaignPayload=[...known.values()].map(campaign=>({ad_account_id:account.id,external_id:String(campaign.id),name:String(campaign.name||campaign.id),status:String(campaign.status||'UNKNOWN'),objective:String(campaign.advertisingChannelType||campaign.advertising_channel_type||'Google Ads'),raw_data:campaign,updated_at:new Date().toISOString()}));
    const {data:savedCampaigns,error:campaignError}=campaignPayload.length?await adminClient.from('campaigns').upsert(campaignPayload,{onConflict:'ad_account_id,external_id'}).select('id,external_id'):{data:[],error:null};
    if(campaignError||!savedCampaigns)throw new Error(campaignError?.message||'Não foi possível salvar as campanhas Google Ads.');
    const localIds=new Map(savedCampaigns.map(row=>[String(row.external_id),row.id]));
    const metrics=rows.map(row=>{const campaign=row.campaign as Record<string,unknown>,segments=row.segments as Record<string,unknown>,values=row.metrics as Record<string,unknown>;return {campaign_id:localIds.get(String(campaign.id)),metric_date:String(segments.date),spend:Number(values.costMicros||values.cost_micros||0)/1_000_000,impressions:Number(values.impressions||0),clicks:Number(values.clicks||0),conversions:Number(values.conversions||0),conversion_value:Number(values.conversionsValue||values.conversions_value||0),currency_code:String(account.currency_code||'BRL'),source_updated_at:new Date().toISOString(),updated_at:new Date().toISOString()}}).filter(row=>row.campaign_id);
    if(metrics.length){const {error}=await adminClient.from('daily_campaign_metrics').upsert(metrics,{onConflict:'campaign_id,metric_date'});if(error)throw new Error(error.message)}
    const keywordRows=await googleSearch(customerId,managerId,token,`SELECT campaign.id, ad_group.id, ad_group.name, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM keyword_view WHERE segments.date BETWEEN '${startDate}' AND '${endDate}' AND campaign.status != 'REMOVED' AND ad_group.status != 'REMOVED' AND ad_group_criterion.status != 'REMOVED' AND ad_group_criterion.negative = FALSE ORDER BY segments.date`);
    const knownKeywords=new Map<string,Record<string,unknown>>();
    keywordRows.forEach(row=>{const group=row.adGroup as Record<string,unknown>|undefined,criterion=row.adGroupCriterion as Record<string,unknown>|undefined,keyword=criterion?.keyword as Record<string,unknown>|undefined,campaign=row.campaign as Record<string,unknown>|undefined;if(!group?.id||!criterion?.criterionId||!keyword?.text)return;const externalId=`${group.id}:${criterion.criterionId}`;knownKeywords.set(externalId,{externalId,group,criterion,keyword,campaign})});
    const keywordPayload=[...knownKeywords.values()].map(item=>{const group=item.group as Record<string,unknown>,criterion=item.criterion as Record<string,unknown>,keyword=item.keyword as Record<string,unknown>,campaign=item.campaign as Record<string,unknown>|undefined;return {ad_account_id:account.id,campaign_id:campaign?.id?localIds.get(String(campaign.id)):null,external_id:String(item.externalId),ad_group_external_id:String(group.id),ad_group_name:String(group.name||group.id),keyword_text:String(keyword.text),match_type:String(keyword.matchType||keyword.match_type||''),updated_at:new Date().toISOString()}});
    const {data:savedKeywords,error:keywordError}=keywordPayload.length?await adminClient.from('google_ads_keywords').upsert(keywordPayload,{onConflict:'ad_account_id,external_id'}).select('id,external_id'):{data:[],error:null};
    if(keywordError||!savedKeywords)throw new Error(keywordError?.message||'Não foi possível salvar as palavras-chave do Google Ads.');
    const keywordIds=new Map(savedKeywords.map(row=>[String(row.external_id),row.id]));
    const keywordMetrics=keywordRows.map(row=>{const group=row.adGroup as Record<string,unknown>,criterion=row.adGroupCriterion as Record<string,unknown>,segments=row.segments as Record<string,unknown>,values=row.metrics as Record<string,unknown>;const keywordId=keywordIds.get(`${group?.id}:${criterion?.criterionId}`);return {keyword_id:keywordId,metric_date:String(segments.date),spend:Number(values.costMicros||values.cost_micros||0)/1_000_000,impressions:Number(values.impressions||0),clicks:Number(values.clicks||0),conversions:Number(values.conversions||0),currency_code:String(account.currency_code||'BRL'),source_updated_at:new Date().toISOString(),updated_at:new Date().toISOString()}}).filter(row=>row.keyword_id);
    if(keywordMetrics.length){const {error}=await adminClient.from('daily_keyword_metrics').upsert(keywordMetrics,{onConflict:'keyword_id,metric_date'});if(error)throw new Error(error.message)}
    await adminClient.from('sync_runs').update({status:'succeeded',finished_at:new Date().toISOString(),records_processed:metrics.length+keywordMetrics.length}).eq('id',run.id);
    await adminClient.from('integrations').update({status:'connected',last_verified_at:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString()}).eq('id',integration.id);
    return {campaigns:savedCampaigns.length,dailyMetrics:metrics.length,keywords:savedKeywords.length,dailyKeywordMetrics:keywordMetrics.length,startDate,endDate};
  }catch(error){const message=error instanceof Error?error.message:'Erro inesperado na sincronização.';await adminClient.from('sync_runs').update({status:'failed',finished_at:new Date().toISOString(),error_message:message}).eq('id',run.id);await adminClient.from('integrations').update({status:'error',last_error:message,updated_at:new Date().toISOString()}).eq('id',integration.id);throw error}
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  try{
    const body=await req.json() as Record<string,unknown>,access=await requireAccess(req,body);
    const endDate=isoDate(body.endDate,todayInSaoPaulo()),start=new Date(`${endDate}T00:00:00Z`);start.setUTCDate(start.getUTCDate()-59);const startDate=isoDate(body.startDate,start.toISOString().slice(0,10));
    if(body.scheduled===true){if(!access.scheduled)return reply({error:'Requisição de agendamento inválida.'},403);const {data:integrations,error}=await adminClient.from('integrations').select('client_id').eq('platform','google_ads').in('status',['connected','error']).not('credential_secret_id','is',null);if(error)throw error;const results=[];for(const integration of integrations||[]){try{results.push({clientId:integration.client_id,ok:true,result:await synchronize(integration.client_id,startDate,endDate)})}catch(error){results.push({clientId:integration.client_id,ok:false,error:error instanceof Error?error.message:'Erro inesperado.'})}}return reply({scheduled:true,results})}
    const clientId=access.clientId||body.clientId;
    if(typeof clientId!=='string')return reply({error:'Cliente inválido.'},400);
    return reply({result:await synchronize(clientId,startDate,endDate)});
  }catch(error){return reply({error:error instanceof Error?error.message:'Erro inesperado.'},400)}
});
