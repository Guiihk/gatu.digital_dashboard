const $ = id => document.getElementById(id);
let clients = [];

function badge(active) {
  return `<span class="connection ${active ? 'connected' : 'pending'}"><i></i>${active ? 'Conectado' : 'Pendente'}</span>`;
}

async function request(action, payload = {}) {
  return invokeFunction('client-admin', {action, ...payload});
}

async function invokeFunction(name, body) {
  const {data, error} = await window.gatuSupabase.functions.invoke(name, {body});
  if (error) {
    let message = error.message;
    try {
      const details = await error.context?.clone().json();
      if (details?.error) message = details.error;
    } catch {}
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

function render() {
  const query = $('client-search').value.trim().toLocaleLowerCase('pt-BR');
  const visible = clients.filter(client => client.name.toLocaleLowerCase('pt-BR').includes(query));
  $('client-count').textContent = clients.length;
  $('client-stats').innerHTML = `<article><span>Total de clientes</span><strong>${clients.length}</strong><small>Contas cadastradas</small></article><article><span>Meta Ads conectado</span><strong>${clients.filter(client => client.meta.connected).length}</strong><small>de ${clients.length} clientes</small></article><article><span>Google Ads conectado</span><strong>${clients.filter(client => client.google.connected).length}</strong><small>de ${clients.length} clientes</small></article><article><span>Integrações completas</span><strong>${clients.filter(client => client.meta.connected && client.google.connected).length}</strong><small>Meta + Google</small></article>`;
  $('client-list').innerHTML = visible.length ? visible.map(client => `<article class="client-row"><div class="client-identity"><span>${client.name.charAt(0)}</span><div><h3>${client.name}</h3><small>${client.slug}</small></div></div><div class="account-cell"><span>Meta Ads</span>${badge(client.meta.connected)}<small>${client.meta.accountId || 'Conta não informada'} · Pixel: ${client.meta.pixelId || 'não informado'}</small></div><div class="account-cell"><span>Google Ads</span>${badge(client.google.connected)}<small>${client.google.accountId || 'Conta não informada'}</small></div><div class="sync-cell"><span>Última atualização</span><strong>${client.updated}</strong></div><div class="client-actions">${client.meta.connected ? `<button class="button sync-meta" data-id="${client.id}" type="button">Sincronizar Meta</button>` : ''}${client.google.connected ? `<button class="button sync-google" data-id="${client.id}" type="button">Sincronizar Google</button>` : ''}<a class="button" href="./?dashboardClient=${encodeURIComponent(client.slug)}">Dashboard</a><button class="button configure-client" data-id="${client.id}" type="button">Configurar</button><button class="button delete-client" data-id="${client.id}" type="button" aria-label="Remover ${client.name}">Remover</button></div></article>`).join('') : '<div class="empty-client">Nenhum cliente encontrado.</div>';
  document.querySelectorAll('.configure-client').forEach(button => button.addEventListener('click', () => openForm(button.dataset.id)));
  document.querySelectorAll('.delete-client').forEach(button => button.addEventListener('click', () => removeClient(button)));
  document.querySelectorAll('.sync-meta').forEach(button => button.addEventListener('click', () => synchronizeMeta(button)));
  document.querySelectorAll('.sync-google').forEach(button => button.addEventListener('click', () => synchronizeGoogle(button)));
}

async function synchronizeGoogle(button) {
  const client = clients.find(item => item.id === button.dataset.id);
  if (!client) return;
  button.disabled = true;
  button.textContent = 'Sincronizando…';
  $('client-announcement').textContent = `Sincronizando campanhas Google Ads de ${client.name}.`;
  try {
    const data = await invokeFunction('google-ads-sync', {clientId: client.id});
    await loadClients();
    $('client-announcement').textContent = `${client.name}: ${data.result.campaigns} campanhas Google Ads e ${data.result.dailyMetrics} resultados diários sincronizados.`;
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Sincronizar Google';
    $('client-announcement').textContent = `Não foi possível sincronizar o Google Ads: ${error.message}`;
  }
}

async function synchronizeMeta(button) {
  const client = clients.find(item => item.id === button.dataset.id);
  if (!client) return;
  button.disabled = true;
  button.textContent = 'Sincronizando…';
  $('client-announcement').textContent = `Sincronizando campanhas de ${client.name}.`;
  try {
    const data = await invokeFunction('meta-sync', {clientId: client.id});
    await loadClients();
    const creativeStatus = data.result.creativeWarning ? ` Imagens não armazenadas: ${data.result.creativeWarning}` : ` ${data.result.creativeAssets || 0} imagens de criativos armazenadas.`;
    $('client-announcement').textContent = `${client.name}: ${data.result.campaigns} campanhas e ${data.result.dailyMetrics} resultados diários sincronizados.${creativeStatus}`;
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Sincronizar Meta';
    $('client-announcement').textContent = `Não foi possível sincronizar o Meta Ads: ${error.message}`;
  }
}

async function removeClient(button) {
  const client = clients.find(item => item.id === button.dataset.id);
  if (!client || !window.confirm(`Remover o cliente “${client.name}”? Esta ação também excluirá suas integrações e dados vinculados.`)) return;
  button.disabled = true;
  button.textContent = 'Removendo…';
  try {
    await request('delete', {id: client.id});
    clients = clients.filter(item => item.id !== client.id);
    render();
    $('client-announcement').textContent = `Cliente ${client.name} removido do Supabase.`;
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Remover';
    $('client-announcement').textContent = `Não foi possível remover o cliente: ${error.message}`;
  }
}

function setGoogleConnection(connected) {
  $('google-connected').value = String(connected);
  const state = $('google-connection-state');
  const button = $('connect-google');
  button.disabled = false;
  state.className = `connection ${connected ? 'connected' : 'pending'}`;
  state.innerHTML = `<i></i>${connected ? 'Google Ads conectado' : 'Não conectado'}`;
  button.textContent = connected ? 'G  Reconectar Google Ads' : 'G  Conectar Google Ads';
  button.classList.toggle('connected', connected);
}

function setMetaConnection(connected) {
  const state = $('meta-connection-state');
  state.className = `connection ${connected ? 'connected' : 'pending'}`;
  state.innerHTML = `<i></i>${connected ? 'Meta Ads conectado' : 'Não conectado'}`;
}

function openForm(id = '') {
  const client = clients.find(item => item.id === id);
  $('client-form').reset();
  $('editing-id').value = client?.id || '';
  $('client-dialog-title').textContent = client ? 'Configurar cliente' : 'Adicionar cliente';
  $('client-name').value = client?.name || '';
  $('client-slug').value = client?.slug || '';
  $('client-slug').disabled = Boolean(client);
  $('meta-account').value = client?.meta.accountId || '';
  $('meta-pixel').value = client?.meta.pixelId || '';
  $('meta-token').value = '';
  setMetaConnection(Boolean(client?.meta.connected));
  $('google-account').value = client?.google.accountId || '';
  $('google-manager').value = client?.google.managerAccountId || '';
  setGoogleConnection(Boolean(client?.google.connected));
  $('client-dialog').showModal();
  $('client-name').focus();
}

async function loadClients() {
  try {
    const data = await request('list');
    clients = data.clients;
    render();
  } catch (error) {
    $('client-list').innerHTML = '<div class="empty-client">Não foi possível carregar os clientes. Atualize a página e tente novamente.</div>';
    $('client-announcement').textContent = `Erro ao carregar clientes: ${error.message}`;
  }
}

$('new-client').addEventListener('click', () => openForm());
$('client-search').addEventListener('input', render);
$('connect-google').addEventListener('click', async () => {
  if (!$('editing-id').value) {
    $('client-announcement').textContent = 'Salve o cliente antes de conectar o Google Ads.';
    return;
  }
  if (!$('google-account').value.trim()) {
    $('google-account').setCustomValidity('Informe o ID do cliente antes de conectar.');
    $('google-account').reportValidity();
    return;
  }
  $('google-account').setCustomValidity('');
  const button = $('connect-google');
  const popup = window.open('', 'gatu-google-ads-oauth', 'popup=yes,width=560,height=720');
  button.disabled = true;
  button.textContent = 'Abrindo Google…';
  try {
    const data = await invokeFunction('google-ads-oauth-start', {clientId: $('editing-id').value});
    if (!popup) throw new Error('Permita pop-ups para iniciar a conexão com o Google.');
    popup.location.href = data.url;
    $('client-announcement').textContent = 'Conclua a autorização na janela do Google.';
  } catch (error) {
    popup?.close();
    button.disabled = false;
    button.textContent = 'G  Conectar Google Ads';
    $('client-announcement').textContent = `Não foi possível iniciar a conexão: ${error.message}`;
  }
});

async function handleGoogleOAuthResult(result) {
  $('connect-google').disabled = false;
  if (!result.ok) {
    $('connect-google').textContent = 'G  Conectar Google Ads';
    $('client-announcement').textContent = `Não foi possível conectar o Google Ads: ${result.message}`;
    return;
  }
  await loadClients();
  const current = clients.find(item => item.id === $('editing-id').value);
  setGoogleConnection(Boolean(current?.google.connected));
  $('client-announcement').textContent = 'Google Ads conectado. Iniciando a primeira sincronização…';
  const virtualButton = {dataset: {id: $('editing-id').value}, disabled: false, textContent: ''};
  await synchronizeGoogle(virtualButton);
}

setInterval(async () => {
  const raw = localStorage.getItem('gatu-google-ads-oauth-result');
  if (!raw) return;
  localStorage.removeItem('gatu-google-ads-oauth-result');
  try { await handleGoogleOAuthResult(JSON.parse(raw)); } catch (_) {}
}, 750);

window.addEventListener('message', async event => {
  const trustedOrigins = [window.location.origin, new URL(window.GATU_CONFIG.supabaseUrl).origin];
  if (!trustedOrigins.includes(event.origin) || event.data?.type !== 'gatu-google-ads-oauth') return;
  await handleGoogleOAuthResult(event.data);
});

window.addEventListener('storage', async event => {
  if (event.key !== 'gatu-google-ads-oauth-result' || !event.newValue) return;
  try { await handleGoogleOAuthResult(JSON.parse(event.newValue)); } catch (_) {}
});
document.querySelectorAll('.dialog-close,.dialog-cancel').forEach(button => button.addEventListener('click', () => $('client-dialog').close()));
$('client-form').addEventListener('submit', async event => {
  event.preventDefault();
  const editing = $('editing-id').value;
  const client = {
    name: $('client-name').value.trim(),
    slug: editing ? clients.find(item => item.id === editing).slug : $('client-slug').value.trim(),
    meta: {accountId: $('meta-account').value.trim(), pixelId: $('meta-pixel').value.trim(), accessToken: $('meta-token').value.trim()},
    google: {accountId: $('google-account').value.trim(), managerAccountId: $('google-manager').value.trim()}
  };
  const submit = event.currentTarget.querySelector('[type="submit"]');
  submit.disabled = true;
  submit.textContent = 'Salvando…';
  try {
    const result = await request(editing ? 'update' : 'create', {id: editing || undefined, client});
    clients = editing ? clients.map(item => item.id === editing ? result.client : item) : [...clients, result.client].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    $('client-dialog').close();
    render();
    $('client-announcement').textContent = `Cliente ${result.client.name} salvo no Supabase.`;
  } catch (error) {
    $('client-announcement').textContent = `Não foi possível salvar o cliente: ${error.message}`;
  } finally {
    submit.disabled = false;
    submit.textContent = 'Salvar cliente';
  }
});

window.addEventListener('gatu-auth-ready', loadClients, {once: true});
