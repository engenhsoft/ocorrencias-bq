# OCORRÊNCIAS B&Q — auditoria técnica geral — 18/10/2026

A auditoria encontrou e corrigiu defeitos de integridade, concorrência, sessão, rascunhos, fotografias, indicadores e exportações no frontend. O backend público recebeu um candidato testado, mas sua presença na fonte ativa e sua implantação oficial permanecem bloqueadas por acesso. Este relatório distingue código corrigido, simulação controlada, leitura de produção e publicação comprovada. Não certifica ausência absoluta de bugs.

## 1. Estado inicial

- Repositório oficial: engenhsoft/ocorrencias-bq. Checkout novo e limpo em main, HEAD 1ec0f688f76f1140c0300f2ab70b68b6d2c75915; nenhuma alteração pendente a sobrescrever. Trabalho isolado na branch audit/20261018-estabilidade. Não houve reset destrutivo ou force push.
- PRs: #1, #3–#8 integrados; #2 encerrado sem integração. Nenhum PR aberto no início. Commits e correções de 15/10 foram lidos antes dos patches; validações atuais de delta, idempotência, confirmação e reconciliação foram preservadas.
- Frontend servido: 2026.10.15.5; build 2026-10-15-fiscal-photo-diagnostics. Pages workflow 38822756789, sucesso no HEAD inicial. index.html, core.js, config.js e service-worker.js responderam 200 e SHA-256 idêntico ao checkout.
- Backend respondendo health: 2026.10.15.4; contrato OCORRENCIAS-BQ-CORRECTION-PERSISTENCE-v12, conferido em 18/10 às 13:45 UTC. A versão numerada 40 consta no histórico de implantação; não foi possível confirmar sua numeração atual no editor/API de deployments.
- Deployment preservado: AKfycbyq_gRMEPzN7xImFqrx-g2mrZt1PCcC4_8RFOinhqONsnpyj6_OmauIPeXe7NGrA31f. Mesmo endpoint /exec configurado no config.js.
- Projeto oficial identificado por metadados Drive: OCORRÊNCIAS B&Q — Backend, ID 1S65w-vU8SNGI3XsrWjZl609yEu4uQRhRrnQrlnI1bSWg1Gyy_xvup94z. Metadados acessíveis; extração da fonte recusada com HTTP 403. Não há ferramenta Apps Script nem identidade Google de runtime configurada para editar/versionar o deployment. Não há formulário seguro de autenticação disponível nesta sessão.
- Planilha indicada confirmada por metadados: Aplicativo Ocorrências, ID 1dpbK_vJ7KNv1fFaLCxixB7jMBdVS-Q5FFjKVoUvXWH0. Abas operacionais, catálogos e abas de backup foram distinguidos; nenhuma foi escrita, copiada ou usada como fonte operacional alternativa.
- O repositório contém três módulos backend públicos e patches; não contém o roteador, autenticação e publicação completos do Apps Script privado. As 45 suítes originais foram inventariadas e um snapshot imutável preservou o baseline.

Evidências: verification/audit-production-initial-20261018.json, audit-baseline-20261018.json e audit-baseline-20261018.md.

## 2. Problemas identificados

Os defeitos de frontend abaixo foram reproduzidos com código real, fixtures locais ou IndexedDB isolado. Os três achados backend são demonstrados nos módulos públicos; exigem comparação com a fonte oficial antes de afirmar incidência em produção.

| ID / gravidade | Fluxo e causa raiz | Evidência e impacto |
|---|---|---|
| INT-01 — P0 | Autosave/envio gravavam sem conferir a versão persistida e ignoravam updatedAt devolvido pelo armazenamento. | Outra aba sobrescrevia dados recentes. Casos Campo/Fiscal, sequência de autosaves, criação e submissão na suíte audit-sync. |
| INT-02 — P0 | Foto Fiscal mesclava dados antigos; a UI promovia o novo timestamp mas conservava campos antigos e salvava novamente. | Reversão de PG, serviços, materiais e recibos já gravados. Testes de adapters reais e Chromium nativo. |
| INT-03 — P0 | Gravação de foto não verificava existência, status e chave atual do slot na transação. | Foto antiga substituía outra chave; gravação tardia recriava rascunho excluído ou alterava fila já enviada. Baseline falha nos cenários nativos correspondentes. |
| PHOTO-01 — P1 | Validação local UUID + slot + uploadKey existia somente no Fiscal. | Campo podia iniciar upload do Blob errado antes da reconciliação recusar a resposta. Quatro tuplas inválidas bloqueadas antes de qualquer envio. |
| DEL-01 — P1 | Descarte usava leitura anterior ao diálogo e exclusão incondicional; limpava a referência ativa sem comparação. | Apagava versão editada/enviada durante confirmação ou referência de outro rascunho. Antes 3/9; depois 9/9. |
| OFF-01 — P2 | Atualização Fiscal abria transação diretamente numa conexão IndexedDB encerrada. | InvalidStateError impedia gravar o rascunho; caminho Campo já possuía reabertura. Reprodução em Chromium real. |
| FIS-01 — P1 | Painel Fiscal indexava drafts somente pelo UUID, apesar de o armazenamento usar pedido/atribuição/ACL. | Retry e confirmação antigos podiam ocultar ou selecionar a solicitação atual. Fixtures com múltiplas atribuições do mesmo UUID. |
| AUTH-FE-01 — P1 | Detalhe/correção/resume de Minhas não conferia sessão depois das leituras/gravações assíncronas. | Dados de Campo A abriam na sessão Campo B. Antes 3/9; depois 9/9. |
| AUTH-FE-02 — P1 | Login/troca de perfil aceitavam resposta depois da mudança de revisão da sessão. | Resposta tardia restaurava sessão após logout; erro antigo escrevia na nova tela. Antes 2/6; depois 6/6. |
| AUTH-FE-03 — P2 | Abertura de correção Fiscal usava session após awaits sem rechecagem. | Logout durante leitura/formulário causava exceção ou mensagem tardia; três casos dirigidos preservam fluxo válido. |
| DATA-01 — P2 | Merge tratava coleção remota explicitamente vazia como ausência de dados. | Serviços/materiais removidos voltavam na exibição local. Antes 9/13; depois 13/13, incluindo omissão e correção pendente. |
| EXP-01 — P2 | Maps/Sets de conformidade e Excel distinguiam grafias válidas do mesmo UUID. | Dupla contagem, linhas e consultas duplicadas; chave de comparação normalizada sem alterar UUID histórico. |
| EXP-02 — P2 | PDF confiava diretamente em photoSlots vazio, repetido ou malformado. | Omitia evidências pendentes e podia consultar slot de confirmação textual/identidade indevida. Fixtures de 5/7 slots. |
| EXP-03 — P2 | onload sem PDFLib mantinha Promise rejeitada em cache. | Retry de PDF impossível até recarregar; teste recupera a segunda tentativa. |
| EXP-04 — P2 | Bloqueio PDF existia somente no botão, sem isolamento da operação por UUID/sessão. | Dois botões iniciavam duas consultas/gerações simultâneas. Teste confirma uma operação e retry posterior. |
| FIS-02 — P2 | Mensagem de reatribuição era escrita após refresh sem revalidar sessão. | Status tardio aparecia após logout/troca de conta; teste de resposta atrasada. |
| UI-01 — P2 | Alteração de senha mestra desabilitava controles sem informar atividade. | Usuário sem feedback durante o processamento. Fixture de sucesso/erro e estado imediato. Nenhuma senha real alterada. |
| BACK-01 — P1, candidato | Transferência Fiscal usava URL/chave como confirmação, ignorando recibo STAGED ou URL divergente. | Intenção de foto pendente desaparecia de requestedPhotoIndexes. Reutilizado photoSlotConfirmed_ existente. |
| BACK-02 — P1, candidato | Três consultas fiscais/documentais não revalidavam ACL após I/O. | Fixtures de revogação/mudança de Base recebiam conteúdo autorizado antes da alteração. Revalidação final pelo mecanismo atual. |
| PERF-01 — P2, candidato | Projeção de cada correção relia duas vezes as mesmas contas fiscais. | Lista com 25 registros: 51 leituras Properties no baseline, 3 no candidato, incluindo revalidação final. |

Não foi constatada necessidade de alterar arquitetura, perfis, regras de fotos, contratos, status remotos ou mecanismo de correção. Nenhum dado histórico foi modificado para reparar código.

## 3. Correções aplicadas

| Bloco | Arquivos/funções principais | Justificativa e regressão |
|---|---|---|
| A — integridade | app.js: ensureActiveRecord, saveActiveDraft, submitOccurrence, storeSelectedPhoto, performSyncSingleRecord; db.js: putPhotoAndRecord/deleteRecord; fiscal-drafts.js | CAS de versão, fila de saves com ancestralidade, preservação de Blob/dados, comparação atômica de slot/status/existência. audit-sync, audit-offline, audit-deletion e IndexedDB Chromium. |
| B — segurança | app.js: handleLogin, handleProfileSwitch, handleMineAction, openAssignedFiscalCorrection; fiscal-workspace.js | Guardas de revisão/token após awaits e isolamento de rascunhos por pedido/atribuição. audit-session, audit-mine-session e audit-fiscal-ui. |
| C — desempenho e consistência | core.js: normalizeOccurrenceRecord/mergeRecordCollections; supervisor-conformity.js; occurrence-excel.js; operational-features.js | Coleção vazia autoritativa, UUID canônico e coalescência PDF; preserves omissões e intenção local de correção. audit-merge e audit-exports. |
| D — interface | app.js: discardDraft; fiscal-admin.js; fiscal-workspace.js; occurrence-pdf.js | EXCLUINDO, fim de loading em todos os caminhos, feedback de senha e retry PDF recuperável. Sem redesign. |
| Backend candidato | backend/FiscalCorrections20261015.gs e OperationalFeatures20261014.gs; sete funções no handoff | STAGED continua pendente, ACL revalidada e snapshot de contas por operação. 26/26 em fixtures; implantação oficial bloqueada. |
| E — regressão/publicação | tests/audit-*-20261018.mjs, testes históricos reparados, workflow Pages, imports/release/SW | Casos dirigidos e testes de navegador. fake-indexeddb 6.2.6 somente no QA, instalado em diretório temporário no CI; nenhuma dependência nova do aplicativo. |

Os mocks de seis suítes antigas foram atualizados para os contratos atuais sem reduzir as validações de resultado. As 44 falhas atribuídas a mocks no baseline não foram contabilizadas como bugs corrigidos do aplicativo. Dez comparações integrais de snapshots históricos continuam documentadas separadamente.

Commits por bloco: d9fb824 (integridade, fotos e sessões); accff41 (merge); a227bd4 (rotas Fiscal); 95da921 (feedback); a59f9b5 (exportações); 44321d3 (backend candidato). Todos são descendentes do checkpoint inicial e foram preservados no PR da release. Os runtimes commitados foram comparados byte a byte ao snapshot testado; evidence em verification/audit-runtime-checkpoint-20261018.json.

## 4. Performance

Medições de produção foram limitadas a consultas sem sessão, health e assets. Não houve login operacional ou mutação real para obter tempos. O health inicial levou 3.138,88 ms em uma amostra; isso não permite mediana/p95. As seis rotas sem sessão levaram 2.374–3.421 ms e retornaram AUTH_REQUIRED; são operações diferentes, sem agregação de percentis.

| Cenário controlado | Antes | Depois | Interpretação |
|---|---:|---:|---|
| Lista backend de 25 correções | 51 leituras Properties | 3 leituras Properties | Redução determinística de 48 chamadas; mesma leitura Sheets. Candidato ainda não implantado. |
| Excel, mesmo UUID em duas grafias | 2 documentos + 10 fotos | 1 documento + 5 fotos | Duplicação evitada sem alterar quatro abas/dados. |
| Coleta Excel, 31 amostras com mock de 2 ms | Mediana 59,139 ms; p95 75,456 ms | Mediana 19,875 ms; p95 52,423 ms | Medição local sob QA concorrente; não demonstra latência Google/Drive. |
| Dois botões PDF do mesmo UUID | 2 consultas em voo | 1 consulta em voo | Comprovado por contagem em fixture; sem SLA de produção. |

Primeira lista do Supervisor, Node/VM com filtros, KPIs e cards reais, sem rede: comparação pareada em um processo, cinco warmups e 40 amostras por versão/cenário, ordem alternada:

| Registros | Antes: mediana / p95 | Depois: mediana / p95 |
|---|---:|---:|
| 50 | 20,368 / 28,053 ms | 20,461 / 40,312 ms |
| 2.000 | 721,591 / 817,819 ms | 734,852 / 803,220 ms |

Não houve melhora comprovada da primeira carga. O p95 de 50 itens ficou maior e a cauda permanece incerta em CPU compartilhada. Uma comparação sequencial N30 inicialmente desfavorável (26,961 → 44,186 ms) motivou o pareamento; os dois resultados estão preservados. O cenário extremo de 2.000 cards continua custoso; não foi introduzida paginação por suposição. Parse, normalização, renderização e esperas simuladas de login/backend estão separados no JSON. Dados: verification/audit-baseline-20261018.json; runner pareado reproduzível ao lado. Não se extrapolam estes valores para dispositivos físicos ou Google.

Salvar, enviar dados/fotos, abrir e reenviar correção, aprovar/publicar e excluir dados remotos não tiveram tempos operacionais de produção medidos, por ausência da fonte/sessão e pela restrição de não criar/alterar ocorrências reais. Exclusão e persistência locais foram verificadas em fixtures e IndexedDB nativo. PDF/Excel válidos foram gerados em ambiente controlado. Não se alegam ganhos nas operações não medidas.

## 5. Segurança

- Corrigidas respostas tardias de autenticação, detalhes locais e correções que atravessavam a troca de sessão.
- O backend oficial recusou seis consultas de leitura sem token: listMine, listPending, listFiscalRecords, getOccurrenceDocument, getDocumentPhoto e listFiscalAccounts. Nenhum campo record/records/accounts/dataUrl retornado. Zero tentativas de login ou escrita operacional.
- Fixtures dos módulos públicos exercitaram conta Fiscal inativa/revisão antiga, Base indevida, perfis recusados na administração, promoção adulterada, revisão de cadastro, atribuição/slot/recibo e revalidação após I/O. Isso não substitui a verificação do roteador/assinatura de tokens privados.
- Entradas HTML permaneceram escapadas nos módulos de cartões/indicadores exercitados. Strings de fórmula no XLSX permaneceram células String, sem fórmula executável; códigos com zeros e quantidades decimais foram preservados. Nenhuma nova dependência de segurança ou alteração de valores foi introduzida.
- Diagnósticos novos usam códigos/etapas; não contêm senhas, tokens, fotos ou respostas operacionais. Artefatos são fixtures e metadados públicos autorizados.
- Backend candidato para revogação durante I/O permanece pendente. Login Campo/Supervisor, expiração/assinatura, rate limiting e toda a matriz real de autorização dependem da fonte oficial. Não houve teste invasivo em produção.

## 6. Integridade

- Identidade local das fotos conferida por UUID + slot 1–7 + uploadKey antes de upload nos dois fluxos. Substituições conservam recibos e Blobs até confirmação.
- Saves e envio não adotam silenciosamente versão de outra aba. Autosaves legítimos da própria fila e fotos de slots diferentes continuam aceitos.
- Gravação tardia não recria registro excluído nem troca slot/status já alterado. Conflito exige reabrir; o registro e a foto previamente persistidos permanecem disponíveis. Não há limpeza automática do IndexedDB.
- Exclusão local usa UUID exato, versão e status na mesma transação. Testes preservam outro UUID com mesmo número operacional e removem todos os sete slots somente do alvo confirmado.
- Campos de correção, requestId, beforePatch/expectedPatch, photoPatch/evidencePatch, fingerprint, supersedesRequestId e rotas existentes continuam usados. Não houve migração automática de LEGACY_FIELD.
- Coleções remotas explicitamente vazias prevalecem; coleções omitidas e correção local pendente continuam preservadas. Indicadores/Excel deduplicam identidade sem reescrever UUIDs históricos.
- Aprovação/publicação e reconciliação já existentes não foram reconstruídas nem relaxadas. Seus fluxos completos sobre a fonte privada não puderam ser novamente executados nesta sessão; HTTP 200/health não foi tratado como confirmação de gravação operacional.

## 7. Testes

**714 verificações numéricas aprovadas:** 705 verificações aplicáveis da regressão final, mais 9 testes PWA reais executados após o snapshot principal. As 705 incluem asserts estáticos e operações isoladas, os 125 casos novos e os 14 de IndexedDB nativo; não são 705 cenários ponta a ponta. O agregado de nove suítes não foi somado novamente.

Adicionalmente, nove grupos UI por viewport e três suítes sem contagem numérica passaram. Zero timeouts. Três casos opcionais financeiros foram ignorados por falta de fixture histórica. Doze invariantes históricos foram segregados: dois passam e dez falham em três suítes integrais antigas. Essas falhas continuam explícitas, sem reduzir validações funcionais. Vinte suítes/perfis privados permaneceram bloqueados e não contam como aprovação.

A execução bruta inicial tinha 578 verificações numéricas, 524 aprovadas e 54 falhas; as falhas foram classificadas em 44 mocks obsoletos e dez invariantes históricos. As suites stability-audit e stability-sweep reparadas também passaram contra o código inicial congelado (58/58 e 42/42), demonstrando que reparar o harness não é correção de runtime. O caso estático de workflow passou a exigir o objeto de correção com a versão realmente persistida. As contagens completas e resultados por suíte estão em verification/audit-baseline-20261018.{json,md}.

O bloco novo mandatory executa nove suítes e 125 casos: sync 28; offline 10; descarte 9; sessão 9; sessão Minhas 9; Fiscal UI 11; merge 13; exportações 10; backend público 26. Sem repetir o agregado na contagem dos casos individuais.

Os 14 casos nativos IndexedDB compararam o mesmo baseline e candidato em contextos novos: antes 3/14, depois 14/14. A cobertura inclui Blobs, persistência, conexão fechada, CAS, exclusão exata, slots 6/7, respostas/seleções concorrentes e preservação de UUIDs. UI Fiscal DOM real, cartões, financeiro e exportações foram exercitados em viewports desktop/mobile em Chromium. Mobile emulado não equivale a Safari/iPhone ou Android físico.

**Atualização PWA real: 9/9.** No mesmo origin localhost, instalou-se 2026.10.15.5, persistiu-se fixture UUID+slot+uploadKey+Blob, apresentou-se 2026.10.18.1 e usou-se o mecanismo existente SKIP_WAITING. HTML/core antigos permaneceram coerentes enquanto waiting; após ativação, HTML/core novos e reload offline funcionaram. O cache antigo do aplicativo foi removido, um cache alheio foi preservado, e o Blob permaneceu byte a byte. O teste offline também recusou a fonte no servidor (503), garantindo que o shell veio do cache. Evidência: verification/audit-pwa-browser-20261018.json.

Matriz de alcance e limites:

| Família | Executado nesta sessão | Limite material |
|---|---|---|
| Formulário, rascunho, validação, serviços/materiais/Trafo | Testes existentes e novos, adaptadores locais e fixtures | Sem cadastro operacional real. |
| Sincronização, fotos, retry, resposta perdida, concorrência | Fixtures frontend/contrato e IndexedDB real; 22 casos históricos Fiscal preservados | Upload/Drive reais e Blob do incidente histórico não disponíveis. |
| Supervisor: listas, navegação, loading, decisão | Testes frontend com mocks corrigidos | Aprovação/publicação/reconciliação completas exigem fonte privada. |
| Fiscal: atribuição, draft entre sessões, dados/fotos, Bases | Controllers, adapters e módulos públicos isolados | Fluxo privado integrado bloqueado. |
| Exclusão | Cancelamento, conflito, sessão, UUID e Blobs locais | Nenhuma exclusão de produção executada. |
| PDF/Excel e indicadores | Arquivos válidos, quatro abas, decimais/zeros, fotos sintéticas, filtros e UI | Três snapshots financeiros históricos não fornecidos; fotos reais não inspecionadas. |
| Segurança | Fixtures de ACL/contas; seis recusas sem sessão no /exec | Sem validação integral da autenticação/roteador privado. |
| Offline/PWA | IndexedDB Chromium e atualização de SW controlada | Sem testes em dispositivos Safari/iOS/Android físicos. |

Os códigos históricos LOCAL_PHOTO_READ_ERROR, CORRECTION_DELTA_MISMATCH, PHOTO_CONFIRMATION_PENDING, CORRECTION_DATA_UNCONFIRMED, INVALID_RECORD_STATE e PUBLISHED_RECONCILIATION_REQUIRED foram localizados em código/testes. As regressões frontend existentes de retomada/contrato foram executadas; as suítes backend de delta/reconciliação não foram declaradas aprovadas sem a fonte privada.

## 8. Publicação

**Frontend 2026.10.18.1 publicado e conferido.**

- Commit de código oficial: 0d238849dc09f8384d938f27050007d74b723cb3, merge do PR #9. Último commit da branch validada: 0ce568a2d1b9fa77307c95d466f471debf91d303.
- PR: https://github.com/engenhsoft/ocorrencias-bq/pull/9.
- Workflow Pages: https://github.com/engenhsoft/ocorrencias-bq/actions/runs/39134571698. Concluído com sucesso em 18/10/2026 às 14:07:52 UTC. Todas as etapas de regressão e Publicar passaram.
- URL: https://engenhsoft.github.io/ocorrencias-bq/. Dezenove assets conferidos por SHA-256 após o deploy, todos idênticos aos arquivos commitados/testados. HTML, módulos, manifest e Service Worker coerentes em 2026.10.18.1; cache ocorrencias-bq-2026.10.18.1.
- Smoke público em Chromium: 1440×1000 e 390×844, versão v2026.10.18.1, login visível, zero erros de página e sem overflow. Apenas tela anônima; sem autenticação ou escrita backend. São dois grupos adicionais de confirmação de publicação, fora dos nove grupos UI locais da regressão.
- Backend final: health 2026.10.15.4, mesmo contrato v12 e mesmo deployment/endpoint. **Nenhuma alteração ou versão nova do Apps Script foi publicada nesta sessão.** A numeração 40 permanece evidência histórica, sem nova verificação da API/editor.
- Evidências: verification/audit-production-final-20261018.json e audit-production-ui-20261018.json. Os commits posteriores que registram relatório/handoff são documentais e conservam os mesmos hashes de runtime.

A adoção da atualização por aparelhos operacionais já instalados não foi observada; o mecanismo de atualização e a preservação dos Blobs foram validados em Chromium local. O relatório está concluído até o bloqueio técnico real do backend.

Frontend mantém o contrato v12 e o endpoint atual; seus patches não exigem as alterações backend candidatas para funcionar. O repositório versiona esses candidatos e os identifica como não implantados. Não houve novo projeto Apps Script, planilha, deployment paralelo ou alteração de outros aplicativos.

## 9. Pendências reais e continuação

1. **Apps Script oficial:** HTTP 403 na extração da fonte, sem ferramenta de deployments/credenciais de runtime. Conferir as sete funções atuais, aplicar somente diferenças ainda necessárias, executar suítes privadas, versionar e atualizar o deployment existente. Pacote Markdown/ZIP inclui patch, substituições, testes, checkpoint, aceite e reversão. Autorização do proprietário já existe; falta acesso técnico.
2. **Regressão backend integral:** 20 suítes/perfis originais bloqueados pela fonte completa, incluindo aprovação, publicação parcial, delta, snapshots históricos, login privado e UI integrada. Executar sobre a fonte candidata; devolver versão/deployment/hash/resultados para continuação. Não executar QA mutante em registros reais.
3. **Incidente de foto no aparelho original:** não há acesso ao Blob/diagnóstico do aparelho que mantém a foto histórica pendente. As regressões de retomada passam, mas o incidente operacional individual não foi declarado resolvido nem dados locais apagados.
4. **Dispositivos físicos:** validar Safari/iPhone e Android reais, especialmente seleção/conversão de imagens, reabertura e adoção da atualização. Os testes desta sessão foram Chromium desktop/mobile emulado.
5. **Performance de listas extremas:** cenário controlado com 2.000 registros completos demonstrou custo de montar HTML integral. Cardinalidade e latência autenticadas de produção não foram medidas. Documentado sem introduzir paginação ou alterar o fluxo por suposição.
6. **Snapshots históricos de comparação:** dez invariantes antigas de igualdade integral de arquivos não correspondem ao produto evoluído, e três fixtures financeiras históricas não foram fornecidas. As diferenças estão registradas, sem esconder falhas ou considerar cenários não executados como aprovados.

O frontend possui correções efetivas verificadas e evidência própria de publicação. A conclusão integral dos controles privados permanece condicionada ao handoff do Apps Script. Nenhuma ocorrência, fotografia de produção, senha, configuração de Base ou histórico foi alterado para QA.
