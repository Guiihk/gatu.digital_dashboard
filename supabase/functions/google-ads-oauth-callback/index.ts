import {createClient} from 'npm:@supabase/supabase-js@2';

const projectUrl=Deno.env.get('SUPABASE_URL')!;
const secretKeys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!);
const oauthClientId=Deno.env.get('GOOGLE_ADS_CLIENT_ID')!;
const oauthClientSecret=Deno.env.get('GOOGLE_ADS_CLIENT_SECRET')!;
const developerToken=Deno.env.get('GOOGLE_ADS_DEVELOPER_TOKEN')!;
const apiVersion=Deno.env.get('GOOGLE_ADS_API_VERSION')||'v25';
const frontendUrl=(Deno.env.get('FRONTEND_URL')||'http://127.0.0.1:4173').replace(/\/$/,'');
const adminClient=createClient(projectUrl,secretKeys.default,{auth:{autoRefreshToken:false,persistSession:false}});

function base64Url(value:Uint8Array){let binary='';value.forEach(byte=>binary+=String.fromCharCode(byte));return btoa(binary).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')}
function decode(value:string){const normalized=value.replaceAll('-','+').replaceAll('_','/').padEnd(Math.ceil(value.length/4)*4,'=');return new TextDecoder().decode(Uint8Array.from(atob(normalized),char=>char.charCodeAt(0)))}
async function sign(value:string){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(oauthClientSecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value))))}
function safeEqual(left:string,right:string){if(left.length!==right.length)return false;let difference=0;for(let index=0;index<left.length;index++)difference|=left.charCodeAt(index)^right.charCodeAt(index);return difference===0}
function page(ok:boolean,message:string){const destination=new URL('/google-oauth-result.html',frontendUrl);destination.searchParams.set('ok',String(ok));destination.searchParams.set('message',message);return Response.redirect(destination.toString(),302)}
function googleError(data:unknown,response:Response){
  const payload=(Array.isArray(data)?data.find(item=>item?.error)||data[0]:data) as {error?:{message?:string;status?:string;details?:Array<{errors?:Array<{message?:string;errorCode?:Record<string,string>;error_code?:Record<string,string>}>}>}};
  const details=(payload?.error?.details||[]).flatMap(item=>item.errors||[]).map(item=>{const codes=Object.values(item.errorCode||item.error_code||{}).filter(Boolean).join('/');return [codes,item.message].filter(Boolean).join(': ')}).filter(Boolean).join(' | ');
  const requestId=response.headers.get('request-id');
  return [payload?.error?.status,payload?.error?.message,details,requestId?`Request ID: ${requestId}`:''].filter(Boolean).join(' — ')||`Google Ads API respondeu com HTTP ${response.status}.`;
}

Deno.serve(async req=>{
  let integrationId:string|undefined;
  try{
    const url=new URL(req.url),errorParam=url.searchParams.get('error');
    if(errorParam)return page(false,'A autorização foi cancelada ou recusada pelo Google.');
    const code=url.searchParams.get('code'),state=url.searchParams.get('state');
    if(!code||!state)throw new Error('O retorno do Google não contém os dados esperados.');
    const [payload,signature]=state.split('.');
    if(!payload||!signature||!safeEqual(signature,await sign(payload)))throw new Error('Estado OAuth inválido.');
    const stateData=JSON.parse(decode(payload));
    if(typeof stateData.integrationId!=='string'||Number(stateData.exp)<Date.now())throw new Error('A tentativa de conexão expirou. Inicie novamente.');
    integrationId=stateData.integrationId;
    const redirectUri=`${projectUrl}/functions/v1/google-ads-oauth-callback`;
    const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:oauthClientId,client_secret:oauthClientSecret,redirect_uri:redirectUri,grant_type:'authorization_code'})});
    const tokens=await tokenResponse.json();
    if(!tokenResponse.ok||!tokens.refresh_token)throw new Error(tokens.error_description||'O Google não retornou um refresh token. Revogue o acesso anterior e tente novamente.');
    const {data:integration,error:integrationError}=await adminClient.from('integrations').select('id,external_account_id,manager_account_id,metadata').eq('id',stateData.integrationId).eq('platform','google_ads').maybeSingle();
    if(integrationError||!integration)throw new Error('Integração Google Ads não encontrada.');
    const customerId=String(integration.external_account_id||'').replace(/\D/g,'');
    const managerId=String(integration.manager_account_id||'').replace(/\D/g,'');
    if(!/^\d{10}$/.test(customerId))throw new Error('O ID do cliente Google Ads deve conter 10 dígitos.');
    const {error:secretError}=await adminClient.rpc('store_integration_credential',{p_integration_id:integration.id,p_secret:String(tokens.refresh_token)});
    if(secretError)throw new Error(secretError.message);
    await adminClient.from('integrations').update({status:'pending',last_error:null,updated_at:new Date().toISOString()}).eq('id',integration.id);
    const headers:Record<string,string>={'Authorization':`Bearer ${tokens.access_token}`,'developer-token':developerToken,'Content-Type':'application/json'};
    if(managerId)headers['login-customer-id']=managerId;
    const verifyResponse=await fetch(`https://googleads.googleapis.com/${apiVersion}/customers/${customerId}/googleAds:searchStream`,{method:'POST',headers,body:JSON.stringify({query:'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer LIMIT 1'})});
    const verifyData=await verifyResponse.json();
    if(!verifyResponse.ok)throw new Error(googleError(verifyData,verifyResponse));
    const customer=verifyData?.[0]?.results?.[0]?.customer||{};
    const metadata={...((integration.metadata as Record<string,unknown>)||{}),oauth_scope:tokens.scope||'https://www.googleapis.com/auth/adwords',connected_at:new Date().toISOString()};
    const {error:updateError}=await adminClient.from('integrations').update({status:'connected',last_verified_at:new Date().toISOString(),last_error:null,metadata,updated_at:new Date().toISOString()}).eq('id',integration.id);
    if(updateError)throw new Error(updateError.message);
    const {error:accountError}=await adminClient.from('ad_accounts').upsert({integration_id:integration.id,external_id:customerId,name:String(customer.descriptiveName||customer.descriptive_name||customerId),currency_code:String(customer.currencyCode||customer.currency_code||'BRL').slice(0,3),timezone:String(customer.timeZone||customer.time_zone||'America/Sao_Paulo'),active:true},{onConflict:'integration_id,external_id'});
    if(accountError)throw new Error(accountError.message);
    return page(true,'A conta foi autorizada e o acesso foi armazenado com segurança.');
  }catch(error){const message=error instanceof Error?error.message:'Não foi possível concluir a conexão.';if(integrationId)await adminClient.from('integrations').update({status:'error',last_error:message,updated_at:new Date().toISOString()}).eq('id',integrationId);return page(false,message)}
});
