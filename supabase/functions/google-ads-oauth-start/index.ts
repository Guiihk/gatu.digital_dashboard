import {createClient} from 'npm:@supabase/supabase-js@2';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Content-Type':'application/json'
};
const projectUrl=Deno.env.get('SUPABASE_URL')!;
const publishableKeys=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')!);
const secretKeys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!);
const oauthClientId=Deno.env.get('GOOGLE_ADS_CLIENT_ID')!;
const oauthClientSecret=Deno.env.get('GOOGLE_ADS_CLIENT_SECRET')!;
const authClient=createClient(projectUrl,publishableKeys.default);
const adminClient=createClient(projectUrl,secretKeys.default,{auth:{autoRefreshToken:false,persistSession:false}});
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:corsHeaders});

function base64Url(value:Uint8Array|string){
  const bytes=typeof value==='string'?new TextEncoder().encode(value):value;
  let binary='';
  bytes.forEach(byte=>binary+=String.fromCharCode(byte));
  return btoa(binary).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}

async function sign(value:string){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(oauthClientSecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value))));
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  try{
    if(!oauthClientId||!oauthClientSecret)throw new Error('As credenciais OAuth do Google Ads não estão configuradas.');
    const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
    if(!token)return reply({error:'Não autenticado.'},401);
    const {data:{user},error:userError}=await authClient.auth.getUser(token);
    if(userError||!user)return reply({error:'Sessão inválida.'},401);
    const {data:profile}=await adminClient.from('profiles').select('role').eq('id',user.id).maybeSingle();
    if(profile?.role!=='admin')return reply({error:'Acesso administrativo necessário.'},403);
    const body=await req.json();
    if(typeof body.clientId!=='string')return reply({error:'Cliente inválido.'},400);
    const {data:integration,error}=await adminClient.from('integrations').select('id,client_id').eq('client_id',body.clientId).eq('platform','google_ads').maybeSingle();
    if(error||!integration)return reply({error:'Salve o cliente antes de conectar o Google Ads.'},404);
    const statePayload=base64Url(JSON.stringify({integrationId:integration.id,clientId:integration.client_id,userId:user.id,exp:Date.now()+10*60*1000,nonce:crypto.randomUUID()}));
    const state=`${statePayload}.${await sign(statePayload)}`;
    const redirectUri=`${projectUrl}/functions/v1/google-ads-oauth-callback`;
    const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search=new URLSearchParams({client_id:oauthClientId,redirect_uri:redirectUri,response_type:'code',scope:'https://www.googleapis.com/auth/adwords',access_type:'offline',prompt:'consent',include_granted_scopes:'true',state}).toString();
    return reply({url:url.toString()});
  }catch(error){return reply({error:error instanceof Error?error.message:'Não foi possível iniciar a conexão.'},400)}
});
