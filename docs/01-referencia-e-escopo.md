# Dashboard de Resultados — referência e escopo inicial

Inspeção: 05/09/2026. Referência: https://app.whatstracker.cloud/

## Objetivo confirmado

Desenvolver um dashboard próprio para clientes da Gatu.Digital, com coleta automática de Meta Ads e Google Ads e implantação futura em VPS particular. Google Ads é requisito do MVP.

Escopo confirmado pelo usuário: começar pelos resultados das campanhas. A tela inicial terá três visualizações: Consolidado (Meta + Google), Meta Ads e Google Ads. Rastreamento próprio de WhatsApp e registro comercial de vendas ficam fora desta primeira entrega.

## Evidências da referência

Inspeção somente de leitura da aba autenticada: dashboard, lista de clientes e opções do menu de configurações. Nenhuma campanha, orçamento, venda ou configuração foi alterada.

- Filtros de cliente e período, comparação com período anterior e gerenciamento de link público.
- Meta de faturamento mensal com progresso e ritmo necessário.
- Indicadores comerciais: vendas, receita, custo por venda, taxa de conversão, ticket médio e receita dividida pelo gasto.
- Indicadores de mídia: investimento, impressões, cliques, leads, mensagens, compras, CPC, CPM e CTR.
- Ranking de criativos, distribuição por posicionamento e mapa de horários de leads/vendas.
- Tabela de leads com campanha, conjunto, anúncio, data de contato, valor e data de venda; ações de converter e visualizar histórico de chat.
- Tabela de campanhas com status e edição de orçamento. Essas ações não foram executadas.
- Lista de clientes com estado da conexão Meta e do link público.
- Menu com Evolution Go API, Fluxos n8n, API Premium, configurações gerais, integrações e logo.
- A interface declara: “Cada tabela do Supabase representa um cliente”. Isso é evidência do texto da interface, não verificação do esquema real do banco.

## Limites da análise

Não há repositório ou código-fonte disponível nesta pasta. Esta etapa analisou a interface renderizada; não auditou JavaScript compilado, backend, banco, autenticação, tarefas agendadas ou integrações. Não se pode afirmar qual é a arquitetura completa a partir dos menus. O funcionamento das ações de escrita não foi testado.

## Melhorias identificadas

- O mesmo total de cliques aparece descrito como cliques totais e cliques no link. Definir a origem e a semântica de cada indicador antes de implementá-lo.
- A interface distingue leads do WhatsApp e conversas iniciadas no gerenciador. Preservar essa distinção e identificar claramente as fontes.
- Receita dividida por gasto em anúncios deve ser apresentada como ROAS quando essa for a fórmula, com origem da receita explícita.
- Evitar tratar ausência de dados ou falha de sincronização como zero de resultado.
- Comparativos devem usar períodos equivalentes e explicitar o tratamento de período anterior igual a zero.

## Proposta de MVP — ainda a validar

1. Gestão de clientes e acesso restrito aos dados de cada cliente.
2. Conexões separadas para Meta Ads e Google Ads.
3. Três visualizações na tela inicial: Consolidado (Meta + Google), Meta Ads e Google Ads; filtros por conta, campanha e período.
4. Investimento, impressões, cliques, CTR, CPC, CPM, conversões e custo por conversão, respeitando a definição de cada plataforma.
5. Evolução diária e tabela comparativa de campanhas.
6. Sincronização agendada com última atualização, falhas visíveis e retentativas.
7. Visão de cliente com identidade da Gatu.Digital.

Somar conversões reportadas pelas plataformas não representa necessariamente pessoas únicas ou vendas deduplicadas. A visão consolidada deverá indicar isso. Receita e ROAS dependem de uma fonte de receita definida.

## Organização da tela inicial

As três visualizações foram confirmadas pelo usuário. Os detalhes abaixo são a proposta funcional para o protótipo.

- Seletor de cliente, período e três abas sempre visíveis. Consolidado será a visualização inicial padrão proposta.
- Trocar de aba preserva cliente e período; filtros específicos de campanha/conta precisam ser compatíveis com a plataforma selecionada.
- Consolidado: indicadores comuns, evolução diária com séries separadas por plataforma, distribuição do investimento entre Meta e Google e tabela de campanhas identificadas pela plataforma.
- Meta Ads: indicadores e campanhas da Meta, com espaço para resultados por objetivo e desempenho dos anúncios.
- Google Ads: indicadores e campanhas do Google, com identificação do tipo de campanha e conversões selecionadas para o relatório.
- Cada plataforma exibe sua última sincronização e estado da conexão. Se uma fonte estiver indisponível, o consolidado informa que está parcial.
- Ausência de conexão, carregamento, falha, ausência de resultados e zero confirmado são estados distintos.

Indicadores iniciais propostos: investimento, impressões, cliques, CTR, CPC, CPM, conversões reportadas e custo por conversão. A definição dos cliques e o mapeamento de conversões ainda precisam ser validados. Não somar resultados de objetivos diferentes sob o rótulo genérico de leads.

Taxas consolidadas serão recalculadas a partir dos totais compatíveis: CTR = cliques / impressões; CPC = investimento / cliques; CPM = investimento / impressões × 1.000. Não usar média simples das taxas das plataformas. Divisões sem denominador válido mostram indisponibilidade. Valores monetários só serão somados na mesma moeda; datas devem seguir uma política explícita de fuso horário.

O MVP será de consulta de resultados. Edição de orçamento e ativação/pausa de campanhas não estão previstas nesta proposta.

## Próximas etapas

1. Usar o escopo de resultados de campanhas confirmado para estruturar o protótipo nas três visualizações. A análise de código da referência continua dependente de acesso autorizado aos arquivos.
2. Definir fontes e fórmulas dos indicadores, frequência de sincronização e forma de acesso do cliente.
3. Consultar a documentação oficial vigente das APIs e validar os acessos necessários antes de prometer integração funcional.
4. Criar protótipo navegável com dados demonstrativos explicitamente identificados.
5. Implementar uma integração de ponta a ponta, validar números contra o gerenciador e depois incorporar a segunda plataforma.
6. Preparar implantação na VPS com HTTPS, segredos no servidor, isolamento entre clientes, backups e monitoramento.

Stack, dimensionamento da VPS e cronograma ainda não definidos.

## Protótipo visual — primeira versão

Implementado em HTML, CSS e JavaScript nativos, sem dependências. Essa escolha serve para validar a interface e não define a stack do backend do MVP.

Referência visual confirmada: imagem enviada pelo usuário, com fundo escuro, menu lateral fixo, destaques azuis e cards em quatro colunas. A primeira versão adapta essa estrutura a oito indicadores de mídia e às três abas solicitadas.

Arquivos: index.html, styles.css, app.js e server.cjs. Instruções no README.md.

Verificações realizadas: sintaxe JavaScript; renderização no navegador; alternância Consolidado/Meta/Google; filtros de cliente e período preservados; busca sem resultados; total consolidado de R$ 7.200 = R$ 3.260 + R$ 3.940; layout móvel a 390 px, sem transbordamento da página. Exportação CSV implementada, ainda sem validação do arquivo baixado. Dados e comparações são fictícios. Integrações, autenticação e implantação continuam pendentes.
