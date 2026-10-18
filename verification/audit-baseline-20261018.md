# Baseline de regressão — 18/10/2026

Fonte congelada por `git archive HEAD`: `1ec0f688f76f1140c0300f2ab70b68b6d2c75915`. Nenhuma alteração dos agentes entrou neste baseline.

45 arquivos de teste/perfil inventariados. Execução sequencial em snapshot isolado; timeout por suíte de 60 s (Node) ou 120 s (UI).

Resultado dos 45 arquivos originais: 18 aprovados, 7 falhos preexistentes, 20 bloqueados por falta do Apps Script principal; zero timeouts. A execução adicional behavior-only passou.

Casos numéricos reportados nas suítes originais: 578 executados, 524 aprovados, 54 falhos, 3 opcionais ignorados. Grupos UI/sem contagem são apresentados separadamente. Estes totais incluem comparações históricas e não representam cobertura integral de produção.

| Suíte | Classe | Resultado | Casos aprovados/falhos | Tempo de suíte (ms) |
|---|---|---|---:|---:|
| audit-regression.mjs | comportamental-isolada | passed | 80/0 | 3862.2 |
| conformity-excel-ui.mjs | ui-isolada | passed | 2 grupo(s) | 13031.23 |
| conformity-excel.mjs | comportamental-isolada | passed | 22/0 | 1182.55 |
| contract-pricing.mjs | comportamental-isolada | passed | 16/0 | 57.92 |
| correction-delta.mjs | comportamental-isolada | blocked | — | — |
| correction-persistence.mjs | comportamental-isolada | blocked | — | — |
| create-photo-commit.mjs | comportamental-isolada | blocked | — | — |
| features-ui.mjs | ui-isolada | blocked | — | — |
| field-historical-correction.mjs | comportamental-isolada | blocked | — | — |
| fiscal-admin.mjs | comportamental-isolada | blocked | — | — |
| fiscal-cards-ui.mjs | ui-isolada | passed | 3 grupo(s) | 55736.25 |
| fiscal-cards.mjs | comportamental-isolada | blocked | — | — |
| fiscal-corrections.mjs | comportamental-isolada | blocked | — | — |
| fiscal-photo-resume.mjs | comportamental-isolada | passed | 22/0 | 927.61 |
| fiscal-workspace-ui.mjs | ui-isolada | blocked | — | — |
| hotfix-performance.mjs | performance-controlada | blocked | — | — |
| hotfix-sync-publication.mjs | comportamental-isolada | blocked | — | 66.25 |
| identifier-readback.mjs | comportamental-isolada | blocked | — | — |
| initial-load-profile.mjs | comportamental-isolada | blocked | — | — |
| login-initial-load.mjs | comportamental-isolada | blocked | — | — |
| login-supervisor-decimal.mjs | estática | passed | 17/0 | 65.29 |
| material-catalog.mjs | comportamental-isolada | passed | 28/0 | 132.17 |
| modal-scroll.mjs | estática | passed | 7/0 | 92.25 |
| occurrence-pdf.mjs | comportamental-isolada | passed | 13/0 | 4811.27 |
| operational-features.mjs | comportamental-isolada | blocked | — | — |
| operational-package.mjs | comportamental-isolada | blocked | — | — |
| operational-stability.mjs | comportamental-isolada | passed | 9/0 | 117.94 |
| photo-sync-notice.mjs | comportamental-isolada | passed | 1 grupo(s) | 116.12 |
| profile-initial-load.mjs | performance-controlada | failed | — | 245.27 |
| profile-stability.mjs | performance-controlada | blocked | — | — |
| publication-reconciliation.mjs | comportamental-isolada | blocked | — | — |
| pwa-release.mjs | estática | passed | 1 grupo(s) | 57.04 |
| service-snapshot-approval.mjs | comportamental-isolada | blocked | — | — |
| stability-audit.mjs | comportamental-isolada | failed | 55/3 | 954.5 |
| stability-sweep.mjs | comportamental-isolada | failed | 33/9 | 459.65 |
| stage-validation.mjs | comportamental-isolada | failed | 62/8 | 1644.61 |
| static-audit.mjs | estática | passed | 51/0 | 1406.77 |
| supervisor-financial-ui.mjs | ui-isolada | passed | 2 grupo(s) | 19272.05 |
| supervisor-financial.mjs | comportamental-isolada | passed | 27/0 | 406.78 |
| supervisor-load-completion.mjs | comportamental-isolada | failed | 1/25 | 680.52 |
| supervisor-navigation.mjs | comportamental-isolada | passed | 1 grupo(s) | 208.0 |
| supervisor-photo-batch.mjs | comportamental-isolada | blocked | — | — |
| supervisor-photos-hotfix.mjs | comportamental-isolada | failed | 19/4 | 227.68 |
| supervisor-workflow.mjs | estática | passed | 14/0 | 91.37 |
| trafo-photo-visibility.mjs | comportamental-isolada | failed | 48/5 | 11987.62 |
| stage-validation.behavior-only.mjs | comportamental-isolada | passed | 60/0 | 197.62 |

Falhas preexistentes reproduzidas:

- `stability-audit`: 55/58, mesmas três divergências de confirmação já documentadas em `docs/fiscal-photo-diagnostics-20261015.md`.
- `stability-sweep`: 33/42; mocks extraídos sem `editingStorage`/`getPhoto`, nove falhas.
- `supervisor-load-completion`: 1/26; mock sem `supervisorMutationVersion`, 25 falhas.
- `profile-initial-load`: assert de carga falha pelo mesmo mock incompleto, antes de produzir métricas válidas.
- `supervisor-photos-hotfix`: 19/23; três mocks de controlador Fiscal ausentes e uma comparação integral histórica.
- `stage-validation`: 62/70; oito comparações históricas de arquivos integrais. O modo oficial `--behavior-only` passou 60/60 e ignorou dez invariantes históricas.
- `trafo-photo-visibility`: ver contagem e mensagens no JSON; a comparação integral de app com commit anterior não contempla evoluções atuais.

As correções posteriores de harness e novas regressões do trabalho atual devem ser avaliadas separadamente deste baseline imutável.

Limitações:

- 20 suítes/perfis requerem fonte principal privada Apps Script ausente e não executaram seus casos.
- Nenhum login operacional, escrita de planilha/Drive, exclusão real ou chamada API operacional foi executado.
- UIs usam Chromium com perfis de viewport; Safari/iOS e aparelhos físicos não testados.
- Latência do frontend em VM e rede sintética não representa Apps Script/Sheets/Drive reais.
- Contagens são casos reportados, sem converter asserts, viewports ou HTTP200 em testes novos.
- Comparações integrais históricas falham após evoluções válidas do projeto; preservadas e discriminadas.

Reparo dos harness após o baseline: as 54 falhas numéricas originais são 44 mocks incompletos e 10 invariantes históricos. O código operacional não foi alterado para fazer esses testes passarem. `stability-audit` e `stability-sweep` reparados também passaram contra a fonte congelada inicial: 58/58 e 42/42. Completion passou 26/26; charts 22/23 e Trafo 52/53, restando somente suas comparações históricas integrais preservadas.

Perfil de primeira carga executado depois do reparo de harness, sempre contra a fonte congelada inicial. N=30 por cenário, Node VM com DOM/rede sintéticos; helpers reais de filtros/KPIs/cards. Asserts exigem exatamente N cards e ausência de fallback de erro. Primeiras tentativas com mock de render incompleto foram descartadas. Não mede Apps Script ou aparelhos físicos. Mediana/p95 (ms):

| Cenário | Login | Primeiro conteúdo | Parse | Normalização | Render HTML | Requests |
|---|---:|---:|---:|---:|---:|---:|
| rápido | 0.080 / 0.685 | 26.961 / 45.956 | 0.542 / 2.546 | 0.629 / 3.343 | 23.263 / 42.515 | [1] |
| atraso controlado | 40.312 / 40.611 | 182.967 / 195.376 | 0.515 / 1.507 | 0.556 / 1.423 | 20.688 / 30.108 | [1] |
| primeira chamada fria simulada | 100.492 / 101.015 | 626.639 / 639.878 | 0.625 / 1.544 | 0.677 / 1.894 | 22.304 / 36.052 | [1] |
| resposta grande | 0.072 / 0.205 | 799.966 / 1046.769 | 18.915 / 67.012 | 20.876 / 75.424 | 736.890 / 993.359 | [1] |
| vazio válido | 0.050 / 0.240 | 0.546 / 0.913 | 0.005 / 0.010 | 0.010 / 0.079 | 0.312 / 0.624 | [1] |
| transitório | 0.058 / 0.132 | 636.255 / 677.536 | 0.572 / 3.044 | 0.861 / 3.403 | 21.632 / 29.406 | [2] |

Esperas de autenticação/backend dos cenários controlados são injetadas: 40/120 ms, 100/500 ms e 5 ms com uma falha inicial. A coluna de requests exclui login e consultas secundárias mockadas. Os valores não devem ser anunciados como ganho da auditoria; ainda requerem comparação com o candidato. A montagem integral de 2.000 cards é um gargalo de CPU demonstrado no cenário extremo; a cardinalidade/payload reais de produção não foram medidos.

Candidato final `2026.10.18.1`, congelado com manifesto SHA-256 em scratch antes das execuções:

- **705 casos de regressão aplicáveis aprovados** (asserts estáticos e operações isoladas), zero falhas finais nesses casos.
- **9 grupos UI por viewport** (três suítes existentes e o DOM Fiscal novo), mais três suítes de verificações sem contagem numérica.
- **3 casos opcionais ignorados** por falta de snapshot financeiro histórico.
- **12 invariantes históricos segregados:** dois passam e dez falham; as três suítes completas preservam seus asserts históricos, sem convertê-los em aprovação.
- **20 suítes/perfis bloqueados** pela ausência da fonte principal oficial privada do Apps Script; o runner agregado foi omitido para não duplicar seus casos individuais.
- Os 60 casos de `stage-validation --behavior-only` foram reexecutados e passaram; já pertencem à contagem única de 705, sem dupla contagem.
- IndexedDB nativo Chromium: **14/14**; no código inicial, **11 falhas entre os mesmos 14 cenários**. O teste bloqueou origens externas.
- Todas as suites tiveram deadline de 60 s (Node) ou 120 s (UI); zero timeouts. Nenhum login ou operação mutante de produção foi executado.

Uma asserção estática de `supervisor-workflow` exigia a chamada antiga `loadRecordIntoForm(correction)`. A correção CAS agora adota o objeto persistido, com `storedCorrection || correction`. A asserção foi atualizada para exigir explicitamente esse retorno persistido, e a suíte passou 14/14.

A comparação N30 sequencial foi desfavorável no primeiro cenário rápido (26,961 → 44,186 ms) e motivou uma verificação dirigida pareada; não se atribuiu a diferença a uma causa presumida. Novo benchmark em **um processo Node**, cinco warmups por versão/cenário, **40 amostras por versão/cenário**, ordem anterior/atual alternada a cada par, sem sleeps de autenticação ou rede, mantendo filtros/KPIs/helpers reais e exigindo todos os cards válidos:

| Registros | Primeiro conteúdo antes mediana/p95 (ms) | Depois mediana/p95 (ms) | Diferença pareada mediana (ms) | HTML antes/depois mediana (ms) |
|---:|---:|---:|---:|---:|
| 50 | 20.368/28.053 | 20.461/40.312 | 0.682 | 18.513/18.756 |
| 2000 | 721.591/817.819 | 734.852/803.220 | 12.342 | 655.835/663.959 |

A piora relativa de 27 → 44 ms não se repetiu na mediana pareada de 50 registros. O p95 de 50 permanece maior; a medição não demonstra melhoria de carregamento, nem exclui toda regressão de cauda. A CPU é compartilhada e a montagem de 2.000 cards continua um gargalo demonstrado. Não foi aplicada otimização genérica ao código. O script reprodutível está em `verification/audit-baseline-20261018.paired.mjs`; os dados N30 antes/depois e todos os pares N40 estão no JSON. Esses tempos de VM não são SLA do Apps Script, do Google Drive ou de celulares.
