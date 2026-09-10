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

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: corsHeaders});

function connection(client: Record<string, unknown>, platform: 'meta_ads' | 'google_ads') {
  const row = (client.integrations as Record<string, unknown>[] | undefined)?.find(item => item.platform === platform);
  const metadata = (row?.metadata as Record<string, unknown> | undefined) || {};
  const connected = row?.status === 'connected' && Boolean(row?.credential_secret_id);
  return platform === 'meta_ads'
    ? {connected, accountId: row?.external_account_id || '', pixelId: metadata.pixel_id || ''}
    : {connected, accountId: row?.external_account_id || '', managerAccountId: row?.manager_account_id || ''};
}

function present(client: Record<string, unknown>) {
  return {
    id: client.id,
    name: client.name,
    slug: client.slug,
    active: client.active,
    updated: new Date(String(client.updated_at)).toLocaleString('pt-BR', {dateStyle: 'short', timeStyle: 'short'}),
    meta: connection(client, 'meta_ads'),
    google: connection(client, 'google_ads')
  };
}

async function requireAdmin(req: Request) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return {error: reply({error: 'Não autenticado.'}, 401)};
  const {data: {user}, error: userError} = await authClient.auth.getUser(token);
  if (userError || !user) return {error: reply({error: 'Sessão inválida.'}, 401)};
  const {data: profile, error: profileError} = await adminClient.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (profileError || profile?.role !== 'admin') return {error: reply({error: 'Acesso administrativo necessário.'}, 403)};
  return {user};
}

function validateClient(input: Record<string, unknown>) {
  const name = String(input.name || '').trim();
  const slug = String(input.slug || '').trim();
  if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('Informe nome e identificador válido.');
  const meta = (input.meta || {}) as Record<string, unknown>;
  const google = (input.google || {}) as Record<string, unknown>;
  return {
    name,
    slug,
    meta: {accountId: String(meta.accountId || '').trim(), pixelId: String(meta.pixelId || '').trim(), accessToken: String(meta.accessToken || '').trim()},
    google: {accountId: String(google.accountId || '').trim(), managerAccountId: String(google.managerAccountId || '').trim()}
  };
}

async function verifyMetaAccount(accessToken: string, accountId: string) {
  if (!/^act_\d+$/.test(accountId)) throw new Error('Informe o ID da conta Meta no formato act_000000000000.');
  const graphVersion = Deno.env.get('META_GRAPH_VERSION') || 'v26.0';
  const url = new URL(`https://graph.facebook.com/${graphVersion}/${accountId}`);
  url.searchParams.set('fields', 'id,name,account_status,currency,timezone_name');
  const response = await fetch(url, {headers: {Authorization: `Bearer ${accessToken}`}});
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error?.message || 'O Meta recusou o token informado.');
  return data as Record<string, unknown>;
}

async function saveClient(id: string | null, input: Record<string, unknown>, userId: string) {
  const client = validateClient(input);
  const verifiedMetaAccount = client.meta.accessToken
    ? await verifyMetaAccount(client.meta.accessToken, client.meta.accountId)
    : null;
  const mutation = id
    ? adminClient.from('clients').update({name: client.name, slug: client.slug, updated_at: new Date().toISOString()}).eq('id', id).select('id').single()
    : adminClient.from('clients').insert({name: client.name, slug: client.slug, created_by: userId}).select('id').single();
  const {data: saved, error: saveError} = await mutation;
  if (saveError || !saved) throw new Error(saveError?.message || 'Não foi possível salvar o cliente.');

  const {data: currentIntegrations, error: currentIntegrationError} = await adminClient
    .from('integrations')
    .select('platform,status,external_account_id')
    .eq('client_id', saved.id);
  if (currentIntegrationError) throw new Error(currentIntegrationError.message);
  const currentMetaStatus = currentIntegrations?.find(item => item.platform === 'meta_ads')?.status || 'pending';
  const currentGoogle = currentIntegrations?.find(item => item.platform === 'google_ads');
  const currentGoogleAccount = String(currentGoogle?.external_account_id || '').replace(/\D/g, '');
  const requestedGoogleAccount = client.google.accountId.replace(/\D/g, '');
  const googleStatus = currentGoogleAccount && currentGoogleAccount === requestedGoogleAccount ? currentGoogle?.status || 'pending' : 'pending';

  const integrations = [
    {client_id: saved.id, platform: 'meta_ads', status: client.meta.accessToken ? 'connected' : currentMetaStatus, external_account_id: client.meta.accountId || null, manager_account_id: null, metadata: {pixel_id: client.meta.pixelId || null}},
    {client_id: saved.id, platform: 'google_ads', status: googleStatus, external_account_id: requestedGoogleAccount || null, manager_account_id: client.google.managerAccountId.replace(/\D/g, '') || null, metadata: {}}
  ];
  const {data: savedIntegrations, error: integrationError} = await adminClient.from('integrations').upsert(integrations, {onConflict: 'client_id,platform'}).select('id,platform');
  if (integrationError || !savedIntegrations) throw new Error(integrationError?.message || 'Não foi possível salvar as integrações.');

  if (client.meta.accessToken) {
    const metaIntegration = savedIntegrations.find(item => item.platform === 'meta_ads');
    if (!metaIntegration) throw new Error('Integração Meta não encontrada.');
    const {error: secretError} = await adminClient.rpc('store_integration_credential', {p_integration_id: metaIntegration.id, p_secret: client.meta.accessToken});
    if (secretError) throw new Error(secretError.message);
    const {error: accountError} = await adminClient.from('ad_accounts').upsert({
      integration_id: metaIntegration.id,
      external_id: String(verifiedMetaAccount?.id || client.meta.accountId),
      name: String(verifiedMetaAccount?.name || client.name),
      currency_code: String(verifiedMetaAccount?.currency || 'BRL').slice(0, 3),
      timezone: verifiedMetaAccount?.timezone_name ? String(verifiedMetaAccount.timezone_name) : null,
      active: Number(verifiedMetaAccount?.account_status || 0) === 1
    }, {onConflict: 'integration_id,external_id'});
    if (accountError) throw new Error(accountError.message);
  }

  const {data: complete, error: fetchError} = await adminClient.from('clients').select('id,name,slug,active,updated_at,integrations(platform,status,external_account_id,manager_account_id,credential_secret_id,metadata)').eq('id', saved.id).single();
  if (fetchError || !complete) throw new Error(fetchError?.message || 'Cliente salvo, mas não pôde ser recarregado.');
  return present(complete);
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: corsHeaders});
  const authorization = await requireAdmin(req);
  if ('error' in authorization) return authorization.error;

  try {
    const body = await req.json();
    if (body.action === 'list') {
      const {data, error} = await adminClient.from('clients').select('id,name,slug,active,updated_at,integrations(platform,status,external_account_id,manager_account_id,credential_secret_id,metadata)').order('name');
      if (error) throw error;
      return reply({clients: (data || []).map(present)});
    }
    if (body.action === 'create') return reply({client: await saveClient(null, body.client || {}, authorization.user.id)}, 201);
    if (body.action === 'update' && typeof body.id === 'string') return reply({client: await saveClient(body.id, body.client || {}, authorization.user.id)});
    if (body.action === 'delete' && typeof body.id === 'string') {
      const {data: removed, error} = await adminClient.from('clients').delete().eq('id', body.id).select('id,name').maybeSingle();
      if (error) throw error;
      if (!removed) return reply({error: 'Cliente não encontrado.'}, 404);
      return reply({deleted: {id: removed.id, name: removed.name}});
    }
    return reply({error: 'Ação inválida.'}, 400);
  } catch (error) {
    return reply({error: error instanceof Error ? error.message : 'Erro inesperado.'}, 400);
  }
});
