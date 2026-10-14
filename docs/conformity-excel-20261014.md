# Ocorrências B&Q — conformidades e Excel consolidado

14/10/2026, America/Bahia. Frontend `2026.10.14.5`, build `2026-10-14-conformity-excel`. Backend `2026.10.14.3`, implantação oficial 33. Duas melhorias implementadas e testadas. A alternância financeira depende da identificação do gráfico existente, ausente no código oficial verificado; nenhum gráfico financeiro foi criado.

## 1. Arquivos modificados

| Arquivos | Mudança |
|---|---|
| `supervisor-conformity.js` | Comparação por eventos confirmados, UUID e filtros |
| `operational-features.js` | Integração do comparativo e seleção/exportação Excel; ACL fiscal recebida do servidor |
| `occurrence-excel.js`, `occurrence-excel-worker.js` | Projeção segura, quatro abas, fotos incorporadas e compactação em worker |
| `app.js`, `index.html`, `styles.css` | Botão junto ao PDF, janela compacta, filtros e apresentação responsiva |
| `backend/OperationalFeatures20261014.gs` | Espelho público da pequena extensão do resumo oficial |
| `patches/backend-conformity-summary-20261014.patch` | Patch incremental reproduzível para `ApprovalIntegrity20260911.gs` |
| `vendor/exceljs-4.4.0.min.js`, `vendor/exceljs-LICENSE.txt` | ExcelJS 4.4.0 e licença MIT, obtidos do pacote oficial |
| `core.js`, `service-worker.js` | Release, build e cache dos novos assets |
| `api.js`, `db.js`, `occurrence-pdf.js` | Somente versão dos imports para o cache; código funcional idêntico |
| `tests/conformity-excel.mjs`, `tests/conformity-excel-ui.mjs` | Fixtures de classificação, XLSX, fotos, autorização e navegador |
| `tests/features-ui.mjs`, `tests/supervisor-photos-hotfix.mjs`, `tests/pwa-release.mjs` | Expectativas da alteração autorizada e espera explícita pelos avisos assíncronos no harness |
| Este relatório e `verification/conformity-excel-20261014.json` | Regras, evidências e limites |

## 2. Regra do gráfico de conformidades

Somente no Modo Supervisor: **Aprovadas sem edição direta × Corrigidas pelo Supervisor**. Uma correção direta comprovada exclui o UUID do grupo de aprovações sem edição, inclusive quando a aprovação acontece depois ou em outro mês. Cada UUID conta uma vez por categoria no período. Rejeições e pedidos à equipe são categorias opcionais e podem se sobrepor; não são somados como um total exclusivo.

A fonte é o histórico completo da planilha, associado ao UUID, complementado pela timeline e correções efetivas persistidas no audit. Não há consulta ao catálogo nem download de fotos para esse cálculo. O mês usa a data do evento no fuso Bahia; Base e chefe usam a identidade histórica disponível. Os filtros de mês/período completo, Base, chefe e agrupamento não alteram os filtros operacionais nem os demais indicadores. Grupos com apenas eventos de categorias desmarcadas não exibem barras sem significado.

## 3. Seleção múltipla e fotos no Excel

GERAR EXCEL abre seleção por UUID com busca, caixas, quantidade selecionada e seleção de todos os registros do filtro atual. Supervisor e Campo reutilizam as listas filtradas existentes. O Fiscal percorre a paginação da consulta oficial mantendo os filtros e as Bases autorizadas devolvidas pelo servidor; uma mudança de ACL interrompe a seleção.

Um único `.xlsx` contém **OCORRÊNCIAS, SERVIÇOS, MATERIAIS e FOTOGRAFIAS**. Inclui identificação, PG, Série/CIA/BTO, conferência, observações e valores persistidos. O campo Projeto só ganha coluna se estiver presente nos dados oficiais; o backend atual não fornece esse campo. Códigos permanecem texto e quantidades permanecem números decimais. Serviços usam preços e totais recebidos, sem recálculo pelo catálogo.

Fotos gerais e evidências dos slots 6/7 são incorporadas, com UUID e slot ao lado. Cada consulta usa o serviço documental existente, que repete a autorização no servidor e valida a identidade do arquivo. UUID/slot divergente, falha de leitura ou foto pendente resultam em indicação de indisponibilidade, nunca na substituição por outra foto. Proporções são preservadas. A geração bloqueia cliques duplicados, permite cancelamento e compacta o arquivo em um worker sem sessão ou chamadas ao backend. O limite de fotos normalizadas é 80 MiB por arquivo; acima disso, o aplicativo pede uma seleção menor. Nenhuma ocorrência é alterada.

## 4. Alternância financeira

**Pendente por ausência do componente mencionado.** Na `main` oficial verificada (`5041affd42038e55c26e2fcbf72fe95a2212415c`), o Supervisor possui TOP 3, ocorrências por Base e não conformidade. Não existe gráfico financeiro nesse modo. As barras de meta diária pertencem ao Campo/Minhas e foram preservadas. Não foi criado outro gráfico nem reaproveitado um indicador incompatível por suposição. A alternância VISUALIZAÇÃO ATUAL | VALORES ALTERADOS não foi publicada.

## 5. Origem dos valores antes/depois

O fonte oficial confirma `audit.supervisorCorrections[].changes`, inclusive o campo **Total da ocorrência**, e `audit.contractRecalculations` com `previousTotal`, `newTotal`, `recalculatedAt` e Supervisor. A timeline identifica `CORRIGIDA_PELO_SUPERVISOR`. Essas fontes poderão sustentar a primeira/última correção por UUID quando o gráfico correto for identificado e houver histórico suficiente. Não foram reconstruídos valores, consultados preços atuais ou exibidos totais financeiros sem esse componente. Correções textuais sem total histórico suficiente não foram tratadas como um par financeiro inventado.

## 6. Testes

| Suíte | Aprovados | Falhas finais |
|---|---:|---:|
| Conformidades + backend de resumo + XLSX | 22 | 0 |
| Operational features, com fonte oficial e mocks | 42 | 0 |
| Operational package, com fonte oficial e mocks | 55 | 0 |
| Supervisor workflow | 14 | 0 |
| Evidências de Trafo e preservação dos fluxos | 53 | 0 |
| Hotfix de fotos e isolamento de perfil | 23 | 0 |
| PDF individual | 13 | 0 |
| UI adjacente: desktop e mobile | 16 | 0 |
| **Casos reportados pelas suítes** | **238** | **0** |

PWA/release/cache passou. O novo harness de navegador passou em dois cenários adicionais (1440×1000 e 390×844): filtros, categorias, download do XLSX com 12 imagens associadas a dois UUIDs, proporções, clique duplicado, PDF individual, paginação fiscal de 61 registros, isolamento do Campo e limpeza no logout. Sem erros de JavaScript ou overflow da página. Cenários entre suítes se sobrepõem; a contagem não representa 238 situações operacionais únicas.

A validação independente com openpyxl também identifica todas as imagens. As fotografias usam âncoras `twoCellAnchor` com os dois pontos dentro da mesma célula de foto; `editAs="oneCell"` preserva o movimento com a célula sem distorção e é válido nesse tipo. O uso de `editAs` em `oneCellAnchor` foi eliminado porque é um atributo de `twoCellAnchor`.

Falhas encontradas na implementação inicial foram corrigidas antes da publicação, incluindo a leitura do objeto audit e a fonte da ACL fiscal na seleção. A suíte UI antiga também passou após esperar explicitamente pelo primeiro aviso assíncrono, eliminando uma corrida no próprio harness. Todos os testes usam usuários, planilhas, Drive, rede e dados sintéticos ou mocks. **Zero login operacional para QA e zero escrita de QA em dados de produção.**

## 7. Apps Script

Atualizado apenas `ApprovalIntegrity20260911.gs`: versão declarada, projeção `conformityRecords` após a verificação do perfil Supervisor e uma função de leitura. O fonte integral restante foi preservado e confirmado no editor. Arquivo auxiliar, manifesto, propriedades, autenticação, triggers, schemas, endpoint e identidade da implantação não foram alterados. As respostas documentais e os endpoints operacionais permanecem iguais.

Fonte inicial SHA-256: `c0c7664a7ca35e7a1ffc161982eff09b64777bcc3810eaa608c9b9cbb36fce74`.

Fonte publicado SHA-256: `7813617f5495c4b11743424c59b042ed21d13338a15fc518a3a09eea5737c499`.

A implantação existente foi atualizada da versão 32 para a **33**, confirmada pela UI em 14/10/2026 às 19:59. Health respondeu `ok: true`, versão `2026.10.14.3`, contrato `OCORRENCIAS-BQ-CORRECTION-PERSISTENCE-v12`, às 20:01:44, no mesmo endpoint.

## 8. Commit, release e publicação

O patch parte de `main` limpa, HEAD `5041affd42038e55c26e2fcbf72fe95a2212415c`, última publicação Pages #59. Todos os commits anteriores permanecem ancestrais. Este relatório pertence ao commit da release frontend **2026.10.14.5**; a publicação usa o workflow Pages existente disparado pelo avanço autorizado de `main`. O resultado e o SHA definitivo são apresentados no relatório final da execução.

## 9. Pendências reais

1. Identificar o gráfico financeiro existente para implementar a alternância solicitada, sem criar outro componente.
2. Safari/iPhone físico e Excel nativo no aparelho não foram testados; as validações de celular foram simuladas em Chromium com fixtures.

Não há alteração operacional decorrente da exportação. A publicação não representa geração de Excel de dados reais nem QA no aplicativo operacional.
