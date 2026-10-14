# Evolução operacional — 14/10/2026

Release `2026.10.14.2`. Continua no frontend original, mesmo Apps Script, deployment, contrato v12 e fontes operacionais. O hotfix de identificadores foi publicado primeiro em `2026.10.14.1`, versão 31, PR #5.

## Avisos e indicadores

O aviso de pendências nasce em cada login ou inicialização com sessão recuperada. Reutiliza os registros da primeira carga do Campo. Considera apenas o proprietário e UUIDs distintos. Dispensar consome o aviso dessa entrada; navegar entre abas e atualizar a lista não o reabre. Uma nova entrada mostra as pendências ainda existentes. As ações abrem a sincronização e o fluxo original de correção por UUID.

`getOperationalSummary` faz uma consulta agregada depois da primeira lista, sem bloquear o login. Campo recebe somente TOP 3 e data de cálculo. Supervisor recebe TOP 3, distribuição por Base e não conformidade. A seleção dos períodos e agrupamentos usa o resumo já recebido; atualizar indicadores é uma consulta única. Sem download de fotografias para calcular métricas.

O TOP 3 deduplica por UUID, considera mês da data original no fuso America/Bahia e registros elegíveis aguardando conferência ou aprovados/publicados, com documentação mínima confirmada. Correções pendentes, rejeitadas, envios parciais e fixtures identificadas são excluídos. Quantidade é o critério principal; nome normalizado resolve empates. Valor histórico é secundário. A identidade original vem do registro/histórico de criação, sem consultar a relação atual de equipes para reatribuir chefias. Os mesmos cálculos atendem Campo e Supervisor.

A distribuição considera as seis Bases oficiais, normaliza grafias e oferece mês atual e histórico completo. A taxa de não conformidade usa UUIDs distintos com decisão real de conferência: correção/reprovação ÷ analisados × 100. Repetições contam uma vez e aprovação posterior preserva a não conformidade. Denominador zero mostra SEM DADOS. Os períodos dos gráficos são independentes dos filtros operacionais do Supervisor.

## PDF

`getOccurrenceDocument` verifica a sessão, proprietário ou Base fiscal antes de entregar um modelo documental, sem URLs privadas, recibos internos ou credenciais. `getDocumentPhoto` confere UUID, slot, confirmação e identidade do arquivo; revalida autorização depois do I/O do Drive. Acesso fiscal não revela URLs permanentes de fotografias.

O documento usa A4, logo B&Q, campos operacionais, tabelas com valores históricos, materiais, conferência, cinco fotos gerais e evidências aplicáveis. Datas são exibidas no fuso Bahia. Tabelas longas repetem o cabeçalho, fotos mantêm a proporção e faltantes são identificadas. O SDK pdf-lib 1.17.1 é versionado no próprio frontend e carregado ao gerar PDF. O botão mostra GERANDO PDF e o download retorna um arquivo PDF real com nome sanitizado. Exportar não aprova nem publica uma ocorrência.

## Fiscal e provisionamento

O novo perfil usa o login e a assinatura de sessões já existentes. Cada fiscal tem credencial individual e Bases autorizadas em `FISCAL_ACCOUNTS_V1`, nas propriedades privadas do projeto. O cadastro contém usuário, salt, hash da senha, Bases, ativo e revisão da autorização. Sem credenciais provisionadas, o login fiscal é recusado.

`configureFiscalAccount_` é um auxiliar privado para o proprietário do Apps Script. Não existe rota pública de provisionamento. Ele mescla o cadastro existente sob lock e gera nova revisão. Alterar ou revogar o cadastro invalida as sessões fiscais anteriores. As consultas verificam o cadastro atual a cada request.

Para preparar uma credencial, o administrador pode executar localmente:

```bash
python3 scripts/prepare-fiscal-config.py --user 'Nome do fiscal' --bases 'CAICÓ' 'CURRAIS NOVOS'
```

O script solicita a senha pelo terminal seguro e imprime apenas a configuração com salt/hash. O proprietário aplica essa configuração por uma chamada administrativa a `configureFiscalAccount_` no projeto oficial. Uma função temporária do editor pode chamar o auxiliar com o JSON resultante; remova essa função depois de configurar. Para revogar, chame o auxiliar com o mesmo cadastro e `active: false`. Não publique configurações reais no repositório ou frontend.

`listFiscalRecords` filtra no servidor antes de devolver dados e KPIs, com paginação de 60 registros. Detalhe, fotos e PDF repetem a autorização por UUID e Base. UUID inexistente e UUID de outra Base recebem a mesma negativa. Os endpoints operacionais, de conferência, sincronização, catálogos e indicadores globais não aceitam sessão fiscal.

O Fiscal consulta, filtra e exporta. Sua entrada não carrega filas locais, diretórios de equipes ou datasets do Supervisor. Logout e troca de perfil limpam dados exibidos e fotografias; os rascunhos e blobs do Campo continuam preservados no armazenamento original.

## Instalação e verificação

Aplicar `patches/backend-operational-features-20261014.patch` ao fonte oficial da versão 31, no mesmo `ApprovalIntegrity20260911.gs`. O arquivo `backend/OperationalFeatures20261014.gs` documenta as funções aditivas já incluídas no patch: **não instalar ambos**, pois isso duplicaria funções. Manter arquivo auxiliar original, manifesto, propriedades, execução e deployment.

Checks principais:

```bash
node tests/operational-features.mjs BACKEND_CANDIDATO.gs
node tests/occurrence-pdf.mjs
node tests/features-ui.mjs BACKEND_CANDIDATO.gs
node tests/identifier-readback.mjs BACKEND_CANDIDATO.gs BACKEND_2026.10.07.3.gs
node tests/stage-validation.mjs --behavior-only
node tests/trafo-photo-visibility.mjs --extension-baseline=7bf8211
node tests/pwa-release.mjs
```

O harness Chromium intercepta todos os requests externos e usa usuários, dados e arquivos sintéticos. `OCCBQ_CHROMIUM_EXECUTABLE` pode selecionar um Chromium local; sem essa variável utiliza a instalação padrão do Playwright. Não há login operacional real ou write de QA em produção.

As dez comparações de isolamento da antiga release de validação por etapas são ignoradas em `--behavior-only`, porque proíbem as funcionalidades agora autorizadas; os 60 testes de comportamento de etapas continuam executados. A proteção do pipeline de fotos é comparada separadamente ao estado inicial desta fase. Campo/Supervisor e suas credenciais continuam cobertos pela regressão existente; o ramo fiscal tem testes próprios de ACL e sessão.

Validação física em Safari/iPhone, câmera e confirmação dos blobs do aparelho original dependem do operador. Provisionar contas reais de fiscais depende de nomes, Bases e credenciais administrativas definidos pelo proprietário.
