const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

function loadEnvironment() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return {};
  return Object.fromEntries(
    fs.readFileSync(envPath, 'utf8')
      .split(/\r?\n/)
      .filter(line => line && !line.trimStart().startsWith('#'))
      .map(line => {
        const separator = line.indexOf('=');
        return separator < 0 ? [] : [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      })
      .filter(entry => entry.length)
  );
}

const environment = {...loadEnvironment(), ...process.env};
const files = {
  '/': 'index.html', '/index.html': 'index.html',
  '/clientes': 'clientes.html', '/clientes.html': 'clientes.html',
  '/login.html': 'login.html',
  '/styles.css': 'styles.css', '/app.js': 'app.js', '/clients.js': 'clients.js',
  '/auth.js': 'auth.js', '/login.js': 'login.js',
  '/assets/gatu-digital-logo.png': 'assets/gatu-digital-logo.png'
};
const types = {'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png'};

const server = http.createServer((req, res) => {
  const requestPath = new URL(req.url, 'http://localhost').pathname;
  if (requestPath === '/config.js') {
    const config = {
      supabaseUrl: environment.SUPABASE_URL || '',
      supabasePublishableKey: environment.SUPABASE_PUBLISHABLE_KEY || ''
    };
    res.writeHead(200, {'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store'});
    res.end(`window.GATU_CONFIG=${JSON.stringify(config)};`);
    return;
  }
  const file = files[requestPath];
  if (!file) { res.writeHead(404); res.end('Not found'); return; }
  res.setHeader('Content-Type', types[path.extname(file)]);
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(path.join(__dirname, file)).pipe(res);
});

const port = Number(environment.PORT || 4173);
server.listen(port, '0.0.0.0', () => console.log(`Dashboard disponível na porta ${port}.`));
