# Ocorrências B&Q — comparativo financeiro do Supervisor

Release frontend `2026.10.14.6`, build `2026-10-14-supervisor-finance`, implementação no commit `b401490b2fc10fd6c53aecf0a8d020154fa36d48`, sobre o HEAD anterior `6606f143c9539c38390d3079d31dd833c4d295d3`. O bloqueio anterior de autenticação foi resolvido pelo formulário seguro. **Backend `2026.10.14.4` publicado na implantação oficial 34**, confirmada em 15/10/2026 às 00:12, America/Bahia. O mesmo endpoint `/exec` respondeu health `2026.10.14.4`, contrato v12, às 00:14:27. A hospedagem frontend utiliza o workflow Pages acionado pela integração desta release na `main`; seu resultado e commit servido devem ser conferidos no GitHub Actions e nos assets oficiais.

## Comportamento

Um único componente no Supervisor, com alternância **VALOR ATUAL | ENVIADO × CORRIGIDO**, sem gráficos simultâneos. Mês atual é o padrão; período completo, meses históricos, Base e chefe de turma filtram a mesma população. Seleções permanecem ao alternar e atualizar os indicadores. A data é a de registro persistida, no fuso Bahia; Base e chefe vêm da linha oficial. Campo e Fiscal não recebem a projeção financeira. O logout limpa os valores e respostas antigas de outra sessão são ignoradas.

Cada UUID com status `PUBLICADA` na aba **OCORRENCIAS** contribui uma vez. Reprovadas, pendências de correção, conferência, sincronização e fixtures não entram. Cópias conflitantes do mesmo UUID geram uma pendência explícita.

O valor enviado é o anterior à primeira intervenção financeira comprovada: juntar e ordenar cronologicamente `audit.contractRecalculations[].previousTotal` e `audit.supervisorCorrections[].changes`, no campo **Total da ocorrência → previousValue**. Os campos `last*` são considerados sem duplicar eventos. O valor final é o **TOTAL DOS SERVIÇOS** persistido. Sem intervenção financeira, ambos usam o valor final. Não há consulta de catálogo nem reconstrução por preços atuais.

Eventos no mesmo horário com o mesmo valor anterior são compatíveis; uma cadeia de valores conectada e única comprova a ordem. Cadeias ambíguas, valor anterior ausente, histórico inválido ou no limite de retenção geram pendência por UUID; o comparativo completo fica indisponível. Nenhum subtotal é exibido como se fosse o total comprovado. Trocas de códigos e alterações apenas textuais sem evento do total não são mudanças financeiras. A soma mantém a precisão dos valores salvos e formata moeda somente após agregar. Diferença e percentual usam **final − enviado**; valores negativos indicam redução. Enviado zero exibe percentual não aplicável.

## Conferência oficial por leitura

A leitura da planilha oficial reproduziu os três recortes de referência sem forçar valores. As mesmas 117 linhas passaram pelo cálculo bruto e pela projeção mínima do backend, com resultados idênticos por UUID. Os dados individuais de produção e o audit integral não foram incluídos neste repositório público.

| Período | UUIDs publicados | Enviado | Corrigido/final | Diferença final − enviado |
|---|---:|---:|---:|---:|
| Completo | 117 | R$ 355.835,31 | R$ 307.528,34 | −R$ 48.306,97 |
| Setembro/2026 | 103 | R$ 329.173,09 | R$ 276.001,29 | −R$ 53.171,80 |
| Outubro/2026 | 14 | R$ 26.662,22 | R$ 31.527,05 | +R$ 4.864,83 |

Zero pendências financeiras no snapshot lido. O manifesto `verification/financial-comparison-20261014.json` guarda totais e SHA-256 do conjunto ordenado de UUIDs/valores. Não foi fornecido um manifesto individual anterior para comparar a composição histórica; os três totais e quantidades coincidem com as referências recebidas, sem necessidade de reconciliação de diferenças.

## Escopo dos arquivos

| Arquivo | Alteração |
|---|---|
| `supervisor-financial.js` | Seleção, cronologia, agregação, pendências e apresentação financeira |
| `operational-features.js`, `index.html`, `styles.css` | Um componente, filtros, alternância e isolamento de sessão/perfil |
| `backend/OperationalFeatures20261014.gs` | Projeção de leitura em `getOperationalSummary_`, somente Supervisor, consultando OCORRENCIAS diretamente |
| `patches/backend-financial-summary-20261014.patch` | Patch incremental para o arquivo oficial `ApprovalIntegrity20260911.gs`; versão proposta do backend `2026.10.14.4` |
| `core.js`, `service-worker.js`, `tests/pwa-release.mjs` | Versão, build, novo asset no cache e verificação da release |
| `app.js`, `api.js`, `db.js`, `supervisor-conformity.js`, `occurrence-excel.js`, `occurrence-excel-worker.js`, `occurrence-pdf.js` | Somente URLs de imports para a nova release; funcionalidade preservada byte a byte após normalizar a versão |
| `tests/supervisor-financial.mjs`, `tests/supervisor-financial-ui.mjs` | Testes financeiros, projeção, regressão oficial e UI sintética |
| Este relatório e manifesto de verificação | Resultado e pendência de publicação |

Dashboard Empresarial, login, aprovação, publicação operacional, fotos, serviços, materiais, IndexedDB e fila de sincronização não receberam alterações funcionais. A nova função do servidor usa apenas leitura de linhas; não chama serviços de escrita ou catálogo.

## Validação concluída

- Financeiro: **30/30**, incluindo os três recortes oficiais, cronologia, empates, aumentos/reduções, ausência de intervenção, múltiplas correções, filtros, UUIDs e dados incompletos.
- Conformidades e Excel: **22/22**; PDF individual: **13/13**; auditoria estática: **47/47**.
- PWA/release/cache, sintaxe dos 11 módulos e navegação do Supervisor: aprovados.
- UI Chromium em **1440×1000 e 390×844**: mesmo contêiner e altura nas duas visualizações, filtros preservados ao alternar/atualizar, mês histórico, ausência de histórico sem totais fabricados, isolamento Campo/Fiscal, logout e resposta tardia, sem overflow ou erros JavaScript.
- **Zero login operacional para QA e zero escrita em dados operacionais.** UI usa sessões e dados fictícios com toda requisição externa interceptada. Safari/iPhone físico não foi testado.

Execução focada:

```sh
OCCBQ_FINANCIAL_SNAPSHOT=/caminho/privado/snapshot.json node --test tests/supervisor-financial.mjs
OCCBQ_CHROMIUM_EXECUTABLE=/caminho/chromium node tests/supervisor-financial-ui.mjs
node tests/conformity-excel.mjs
node tests/occurrence-pdf.mjs
node tests/pwa-release.mjs
node tests/static-audit.mjs
node tests/supervisor-navigation.mjs
```

O snapshot privado tem formato `{ "records": [...] }` e contém as projeções das colunas oficiais necessárias. Sem esse arquivo, os três testes oficiais são marcados como não executados; os outros casos permanecem reproduzíveis com fixtures.

## Registro de publicação

- Autenticação Google concluída pelo proprietário no fluxo seguro, sem credenciais no chat e sem login no aplicativo operacional.
- Fonte oficial anterior: SHA-256 `7813617f5495c4b11743424c59b042ed21d13338a15fc518a3a09eea5737c499`, idêntico ao checkpoint documentado da versão 33.
- Fonte aplicado, salvo e conferido após recarregar o editor: SHA-256 `732e0f8851632972d45ddaa101c4d3196bd4832f02e3ceac0e02d027a0c05756`.
- Delta aplicado: somente a versão declarada, `getOperationalSummary_` e a função de projeção financeira já preparada. O cabeçalho do patch foi ajustado à linha 6 do fonte oficial; não houve alteração funcional no patch.
- Implantação oficial atualizada de 33 para **34**, no mesmo projeto e com o mesmo código de implantação `AKfycbyq_gRMEPzN7xImFqrx-g2mrZt1PCcC4_8RFOinhqONsnpyj6_OmauIPeXe7NGrA31f`.
- Endpoint preservado: `https://script.google.com/macros/s/AKfycbyq_gRMEPzN7xImFqrx-g2mrZt1PCcC4_8RFOinhqONsnpyj6_OmauIPeXe7NGrA31f/exec`.
- Manifesto, propriedades, arquivo auxiliar, triggers, permissões, serviços e dados operacionais preservados. Sintaxe do fonte integral conferida sem executá-lo.

O frontend é integrado sem force push e sem modificar o código funcional do commit `b401490`. O workflow de publicação é `.github/workflows/pages.yml`; a confirmação final depende de conclusão `success` e comparação dos arquivos servidos no site oficial com a árvore publicada. Os identificadores do workflow e a verificação dos assets são informados no relatório final da publicação.

Site oficial: https://engenhsoft.github.io/ocorrencias-bq/
