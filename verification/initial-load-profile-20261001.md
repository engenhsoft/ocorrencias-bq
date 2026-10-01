# Primeira carga: medição e correção — 2026-10-01

Estado inicial: checkout limpo em `hotfix/login-initial-load-20261001`, HEAD e remoto `main` em `64b33e8075d0f42932ea28a7c0ebff5785f82c1f`. Frontend/backend 2026.10.01.2, Apps Script versão 22. Trabalho preservado; correção isolada em `hotfix/initial-load-profile-20261001`.

## Resultado medido

Quatro amostras por versão, em duas execuções independentes do editor oficial do Apps Script, com os mesmos dados e instrumentação de leitura. A mediana do backend da primeira carga do Supervisor caiu de **5.081,5 para 640,5 ms (87,4%)**. Antes: 7.301 / 5.196 / 4.967 / 4.326 ms. Depois: 1.439 / 562 / 719 / 248 ms. Há variação de infraestrutura entre execuções; esses números não são uma medição do login válido nem do tempo completo no dispositivo do usuário.

O JSON permaneceu idêntico, com 386.088 bytes, 30 registros, 4 pendências e 120 entradas de métricas. SHA-256 da resposta: `774cf767629a9c48ba616a22d83b4127767e65c5a1b9481eb6ec9dc409bd9248`. Não foi exportado conteúdo dos registros para estas evidências.

## Linha de base antes da correção

Primeira amostra real do backend; percentuais calculados sobre 7.301 ms, sem somar etapas aninhadas.

| Etapa | Antes | % do total |
|---|---:|---:|
| Consultas individuais ao cache das referências | 4.515 ms | 61,8% |
| Conferência de cinco cabeçalhos | 1.224 ms | 16,8% |
| Abertura da planilha | 814 ms | 11,1% |
| Demais leituras, montagem, serialização e retorno | 748 ms | 10,2% |
| Total | 7.301 ms | 100% |

Os dois maiores custos internos nessa amostra foram as consultas de cache e a conferência de cabeçalhos. Fora do backend medido, as chamadas HTTP de controle também apresentaram espera elevada.

## Autenticação, bootstrap e frontend

| Etapa | Antes (ms) | Depois (ms) | Contexto |
|---|---:|---:|---|
| Autenticação: referências reais + código com credencial fictícia | 61,000 | 90,000 | Medianas no editor, sem login válido; código inalterado |
| Bootstrap da interface | 0.017 | 0.022 | VM com DOM simulado, 50 registros |
| Backend das ocorrências | 5.081,500 | 640,500 | Leituras reais protegidas, quatro amostras |
| JSON.parse + normalização | 0.604 | 0.612 | VM, 50 registros |
| Geração do primeiro HTML | 7.459 | 7.015 | VM, 50 registros; não mede pintura no navegador |

Os contextos desta tabela são distintos e seus tempos não devem ser somados. O frontend não foi alterado; diferenças no harness representam variação da execução, não ganho atribuível a uma mudança de código. A autenticação não demonstrou redução.

Os marcadores T0–T8 de cada amostra estão no JSON de evidências: início do login, envio/resposta da autenticação, persistência da sessão, abertura da interface, envio/resposta da lista, final da normalização e geração do HTML. DOM, rede e credenciais do cliente são simulados. O código real de normalização e geração de HTML foi executado.

| Cenário controlado | Login antes / depois (ms) | Primeiro conteúdo antes / depois (ms) | Requests da lista antes / depois |
|---|---:|---:|---:|
| rápido | 0.039 / 0.058 | 8.231 / 7.862 | 1 / 1 |
| atraso controlado | 40.391 / 41.076 | 168.280 / 169.844 | 1 / 1 |
| primeira chamada fria simulada | 100.459 / 100.511 | 608.097 / 608.849 | 1 / 1 |
| resposta grande | 0.057 / 0.061 | 235.958 / 236.654 | 1 / 1 |
| vazio válido | 0.045 / 0.037 | 0.162 / 0.145 | 1 / 1 |
| transitório | 0.052 / 0.051 | 620.100 / 620.836 | 2 / 2 |

Três amostras por cenário; medianas. A primeira chamada fria é **simulada**, com atrasos explícitos de 100 ms na autenticação e 500 ms na lista; não comprova cold start real. O erro transitório mantém o único retry de 600 ms previamente existente. O dataset grande contém 2.000 registros e 4.406.944 bytes sintéticos. O custo de avisos no terminal foi excluído da medição de CPU e a quantidade de avisos foi contada.

## Causas e correção aplicada

O login vigente já aguardava apenas autenticação, criação/restauração da sessão e liberação da interface. Nenhum diretório, catálogo, material, notificação, ocorrência, histórico ou sincronismo estava sendo aguardado no login; nenhuma dessas dependências precisou ser movida novamente. A primeira requisição do Supervisor já era coalescida e única, com lista/KPIs/badges/contadores no mesmo dataset. O Campo continua consultando somente seu fluxo, sem dataset do Supervisor.

A demora interna após o login incluía 164 RPCs individuais ao cache de permissões já existentes e leituras integrais de serviços/materiais que a lista pendente não utilizava. Pendências usam os snapshots da própria linha; os detalhes publicados continuam sob demanda no endpoint existente.

O patch da primeira carga faz uma leitura em lote das mesmas chaves públicas de referência, limitada a 500 chaves por lote. Não altera regras, upload, permissões, URLs, blobs, retry ou estados das fotos. Cache ausente ou falha na leitura em lote usa a conferência individual anterior. Não adiciona cache de senha, sessão ou dataset operacional.

Remove os mapas globais de serviços e materiais dessa consulta e a execução de migração/conferência de cabeçalhos no caminho de leitura. As operações de escrita preservam a preparação de abas. A planilha continua sendo aberta uma vez. A aba operacional canônica é `OCORRENCIAS_AGUARDANDO_SUPERVISOR`; a aba `OCORRENCIAS` continua necessária às métricas publicadas, reconciliação, exclusão de cópias pendentes e total diário. A leitura oficial termina na coluna 41, última coluna utilizada por esse endpoint.

| Leitura | Antes | Depois |
|---|---:|---:|
| Aguardando Supervisor | 43 × 46 | 43 × 46 |
| Ocorrências oficiais | 77 × 46 | 77 × 41 |
| Serviços | 409 × 10 | 0 |
| Materiais | 466 × 8 | 0 |
| Cabeçalhos | 5 ranges, 129 células | 0 |
| Total de células | 13.467 | 5.135 (−61,9%) |
| Ranges de dados | 4 | 2 |
| Consultas de cache disponíveis | 164 individuais | 1 em lote |
| Payload | 386.088 bytes | 386.088 bytes |

Não havia leitura de dados do histórico nem de `BKP_*` na primeira carga. A resposta completa da pendência foi preservada, pois a tela de conferência utiliza o mesmo objeto; uma nova arquitetura de detalhes não foi necessária para retirar os mapas inutilizados. Não são enviados blobs, apenas referências de imagens.

## Validação e publicação

179 testes aprovados: performance/paridade 13, login/carga inicial 45, snapshots/aprovação 40, pacote operacional 55, estabilidade 9 e login/Supervisor/decimais 17. Auditorias de PWA e navegação também aprovadas. Incluem cache vazio/parcial/privado/erro, falha de arquivo, lote de 1.100 referências, UUID repetido, Nº ocorrência repetível, códigos string/zeros à esquerda, QTD decimal, conteúdo de pendências, sessão tardia, requests simultâneas, erro/vazio e ausência de refetch duplicado.

Não houve login real no aplicativo, pedido de senha operacional nem escrita em registros, planilha ou fotos. A instrumentação de medição bloqueou escrita e usou somente cache/Drive em leitura; não foi publicada. Todos os arquivos finais do Apps Script foram exportados e comparados ao candidato testado; manifesto preservado e somente os dois arquivos existentes.

Backend publicado: **2026.10.01.3, versão 23**, no mesmo projeto/deployment/endpoint:

- Projeto: `1S65w-vU8SNGI3XsrWjZl609yEu4uQRhRrnQrlnI1bSWg1Gyy_xvup94z`
- Deployment: `AKfycbyq_gRMEPzN7xImFqrx-g2mrZt1PCcC4_8RFOinhqONsnpyj6_OmauIPeXe7NGrA31f`
- Fonte final SHA-256: `14177f5d63d00fbc0a5537e96217141f2ac41b466d25350f102ec1c8d1631031`

Frontend/PWA: **2026.10.01.2**, sem alteração em assets, service worker, cache ou novidades. Os commits anteriores permanecem na história.

## Limitação real do login

Controles HTTP sem credenciais, realizados sequencialmente no ambiente disponível:

| Controle | Antes (ms) | Depois (ms) |
|---|---:|---:|
| Health 1 | 21.177,33 | 14.607,90 |
| Login vazio 1 | 13.396,45 | 18.053,90 |
| Health 2 | 14.513,14 | 16.271,31 |
| Login vazio 2 | 17.765,20 | 16.817,33 |
| Health 3 | 22.687,43 | 18.528,65 |

Antes, as cinco execuções correspondentes registraram 682 / 590 / 883 / 769 / 703 ms no painel do Apps Script. Portanto grande parte da espera de controle ocorre fora da execução registrada. Depois, as cinco execuções registraram 844 / 1.060 / 519 / 503 / 751 ms, enquanto os controles externos continuaram entre 14.607,90 e 18.528,65 ms. Também há 302 do ContentService seguido de outra transferência HTTP, registrada no JSON. Não se atribui essa diferença exclusivamente a cold start: a demora persistiu em chamadas subsequentes.

Esses controles não medem a autenticação válida nem o Safari/dispositivo do usuário. Não é possível determinar, somente com eles, quanto vem de rede/egresso deste ambiente, redirecionamento, fila ou inicialização do Google. O código de autenticação foi preservado e a espera externa não foi eliminada. A redução de 87,4% aplica-se ao backend da lista; não deve ser anunciada como redução equivalente de todo o login.

## Reprodução

```bash
node tests/initial-load-profile.mjs /caminho/backend-corrigido.gs /caminho/backend-2026.10.01.2.gs
node tests/profile-initial-load.mjs . /caminho/medicoes-frontend.json
```

Os fontes privados do Apps Script devem ser fornecidos localmente aos testes. O repositório guarda somente o patch, os testes e evidências agregadas, sem credenciais ou conteúdo operacional.
