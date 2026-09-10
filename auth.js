import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';

const config = window.GATU_CONFIG;
if (!config?.supabaseUrl || !config?.supabasePublishableKey) {
  document.body.innerHTML = '<main class="auth-error">A configuração do Supabase não foi encontrada.</main>';
  throw new Error('Supabase configuration is missing.');
}

const supabase = createClient(config.supabaseUrl, config.supabasePublishableKey);
window.gatuSupabase = supabase;

async function protectPage() {
  const shareToken = new URLSearchParams(location.search).get('share');
  if (shareToken) {
    document.body.classList.add('shared-view');
    document.body.classList.remove('auth-pending');
    window.dispatchEvent(new CustomEvent('gatu-share-ready', {detail: {token: shareToken}}));
    return;
  }
  const {data: {session}} = await supabase.auth.getSession();
  if (!session) {
    const next = location.pathname + location.search + location.hash;
    location.replace(`/login.html?next=${encodeURIComponent(next)}`);
    return;
  }

  const {data: profile, error} = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', session.user.id)
    .maybeSingle();

  if (error || !profile) {
    await supabase.auth.signOut();
    location.replace('/login.html?error=unauthorized');
    return;
  }

  const isAdmin = profile.role === 'admin';
  if (!isAdmin && location.pathname.endsWith('/clientes.html')) {
    location.replace('/');
    return;
  }

  document.querySelectorAll('[data-admin-only]').forEach(element => {
    element.hidden = !isAdmin;
  });

  const toolbar = document.querySelector('.toolbar');
  if (toolbar && !document.getElementById('sign-out')) {
    const button = document.createElement('button');
    button.id = 'sign-out';
    button.className = 'button sign-out';
    button.type = 'button';
    button.textContent = 'Sair';
    button.addEventListener('click', async () => {
      await supabase.auth.signOut();
      location.replace('/login.html');
    });
    toolbar.append(button);
  }

  document.body.classList.remove('auth-pending');
  document.body.dataset.userName = profile.full_name || session.user.email || '';
  document.body.dataset.userRole = profile.role;
  window.dispatchEvent(new Event('gatu-auth-ready'));
}

if (document.body.hasAttribute('data-requires-auth')) protectPage();
