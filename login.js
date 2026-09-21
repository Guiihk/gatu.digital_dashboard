import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';

const config = window.GATU_CONFIG;
const form = document.getElementById('login-form');
const error = document.getElementById('login-error');
const params = new URLSearchParams(location.search);
const next = params.get('next') || '/';
const supabase = createClient(config.supabaseUrl, config.supabasePublishableKey);

if (params.get('error') === 'unauthorized') error.textContent = 'Este usuário não possui acesso administrativo ao painel.';

const {data: {session}} = await supabase.auth.getSession();
if (session) location.replace(next);

form.addEventListener('submit', async event => {
  event.preventDefault();
  error.textContent = '';
  const submit = form.querySelector('button');
  submit.disabled = true;
  submit.textContent = 'Entrando…';
  const {error: signInError} = await supabase.auth.signInWithPassword({
    email: document.getElementById('email').value.trim(),
    password: document.getElementById('password').value
  });
  if (signInError) {
    error.textContent = 'Não foi possível entrar. Verifique seu e-mail e senha.';
    submit.disabled = false;
    submit.textContent = 'Entrar';
    return;
  }
  location.replace(next);
});
