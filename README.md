# Gatu.Digital — Dashboard de Resultados

Protótipo navegável baseado na referência visual enviada pelo usuário: menu lateral fixo, superfícies escuras, destaques azuis e cards em quatro colunas no desktop.

Identidade atual: cor de destaque `#830A7D` e logotipo oficial em `assets/gatu-digital-logo.png`.

## Executar

Requer Node.js. Na pasta do projeto:

```sh
node server.cjs
```

Abrir http://127.0.0.1:4173. Também é possível abrir index.html diretamente. Não há instalação de dependências.

## Publicar no EasyPanel com GitHub

1. Envie este diretório para um repositório privado no GitHub, incluindo `Dockerfile` e `.dockerignore`, mas sem o arquivo `.env`.
2. No EasyPanel, crie um serviço do tipo **App** a partir do repositório GitHub e selecione a branch de produção.
3. O EasyPanel deve detectar o `Dockerfile`. Configure a porta interna como `4173`.
4. Em **Environment**, crie apenas estas variáveis públicas do frontend:

   ```text
   SUPABASE_URL=https://xprunvfyqelaihtgweob.supabase.co
   SUPABASE_PUBLISHABLE_KEY=<sua publishable key do Supabase>
   ```

5. Adicione o domínio `dashboard.gatu.digital`, habilite HTTPS e direcione-o para a porta `4173`.

Depois da primeira publicação, configure no Supabase Auth as URLs `https://dashboard.gatu.digital` e `https://dashboard.gatu.digital/login.html` como URLs de redirecionamento permitidas.

## Incluído

- Abas Consolidado, Meta Ads e Google Ads com suporte a teclado.
- Filtros de cliente e período, incluindo intervalo personalizado de até 366 dias, preservados na troca de aba.
- Nove indicadores, incluindo taxa de conversão do site, comparação com período anterior e distribuição do investimento.
- Gráfico diário selecionável: investimento, custo por conversão e taxa de conversão do site, nas três abas. A seleção é preservada ao trocar plataforma, cliente e período.
- Tabela com pesquisa, ordenação por investimento e exportação CSV dos resultados filtrados.
- Ranking dos três criativos/anúncios com mais conversões, filtrado por plataforma e período.
- Comparativo visual de investimento e conversões por campanha e gráfico de rosca da distribuição dos gastos.
- Geração de link exclusivo por cliente, persistido localmente no protótipo, com janela de cópia e modo de acesso compartilhado.
- Página de clientes com cadastro, busca, edição e estados separados das integrações Meta Ads e Google Ads.
- Configuração Meta com conta de anúncios, Pixel ID e campo mascarado de Access Token; o token é descartado no protótipo local.
- Layout responsivo e dados fictícios identificados na interface e na exportação.

## Limites

Este é um protótipo de interface, não o MVP integrado. Não possui autenticação, banco, conexão às APIs, sincronização ou implantação na VPS. Todos os resultados e comparações são demonstrativos e determinísticos; períodos são ancorados em 04/09/2026 para revisão consistente. As conversões não representam pessoas únicas. Não há rastreamento de WhatsApp nem registro de vendas.

Os links de cliente usam armazenamento local e `localhost`, portanto funcionam apenas neste navegador e computador. Na versão implantada, o identificador deverá ser aleatório, armazenado no banco, revogável, protegido contra enumeração e associado no servidor a um único cliente. O link público não deve expor credenciais das plataformas.

O servidor local expõe somente os arquivos da interface, em loopback. Para produção, definir arquitetura, autenticação e integrações antes da implantação.

## Taxa de conversão do site

Definição adotada no protótipo: sessões com pelo menos uma conversão / sessões do site atribuídas à plataforma × 100. Fonte demonstrativa separada das conversões dos anúncios; formulários instantâneos não entram nessa taxa. No consolidado, somam-se numeradores e denominadores de grupos de sessões distintos. A implementação real dependerá da definição de eventos e da fonte de analytics do site.

Os gráficos de custo e taxa calculam razões dos volumes diários demonstrativos; dias sem denominador válido ficam sem ponto. O card usa os totais do período, não a média das taxas diárias. Verificadas no navegador as nove combinações de aba e métrica, sem valores NaN/Infinity.
