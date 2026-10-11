# Visibilidade imediata das evidências de Trafo

Ao selecionar SUBSTITUIÇÃO DE TRAFO após a renderização inicial sem ocorrência ativa, a seção dos transformadores aparecia, mas os cartões de evidência 6 e 7 continuavam ocultos. `handleFormInput()` atualizava a seção sem chamar `updatePhotoGrid()`, que havia definido `hidden = true` durante `renderPhotoGrid()`.

O patch registra a presença anterior de Trafo antes de `syncFormToRecord()` e chama `updatePhotoGrid()` quando essa presença muda. A seção e os cartões passam a refletir o mesmo estado antes do autosave. Digitar outro campo não redesenha a grade; a atualização visual não faz upload nem exclui blobs.

- Base: `main`, commit `5968b6eae8440c1efdfacf479770a9cc4a213889`, frontend/SW `2026.10.07.3`.
- Branch: `hotfix/trafo-photo-visibility-20261011`.
- Release: `2026.10.11.1`, build `2026-10-11-trafo-photo-visibility`.
- Mudança funcional: duas linhas em `handleFormInput()`. Demais mudanças de runtime são identificadores de release/cache.
- Os cartões permanecem incorporados à seção original, na etapa de dados. HTML estrutural e CSS permanecem iguais.
- Apps Script, backend, Google Sheets, serializer, fingerprint, requestId, persistência, upload, UUID e regras de negócio permanecem inalterados.

## Reprodução e prova

O mesmo teste carrega o HTML e o aplicativo reais em VM, registra `bindEvents()`, renderiza sem ocorrência ativa e dispara `change` no checkbox. O DOM, armazenamento e seleção de arquivos são simulados; nenhuma autenticação é executada.

```bash
# No HEAD inicial: exit 1; photoCard6.hidden continua true após selecionar Trafo.
node tests/trafo-photo-visibility.mjs --regression-only --source-ref=5968b6eae8440c1efdfacf479770a9cc4a213889

# Com o patch: todos os cenários passam.
node tests/trafo-photo-visibility.mjs
node tests/stage-validation.mjs
node tests/pwa-release.mjs
```

## Validação final

| Suíte | Aprovados | Falhos |
|---|---:|---:|
| Visibilidade Trafo | 53 | 0 |
| Validação por etapas | 70 | 0 |
| Delta de correção | 51 | 0 |
| Persistência de correção | 53 | 0 |
| Serviços históricos em correção | 48 | 0 |
| Commit de dados/fotos CREATE | 24 | 0 |
| Estabilidade de ações/armazenamento | 9 | 0 |
| **Total de casos** | **308** | **0** |

Dois grupos adicionais passaram: aviso de sincronização fotográfica e coerência da release/PWA. O frontend é estático, sem bundler: sintaxe dos módulos, imports, assets, manifesto e `git diff --check` também passaram.

A suíte nova cobre seleção inicial, seleção/desmarcação rápida, autosave atrasado, Sub-base, chegada do diretório, inclusão real de serviço, retorno de etapa, tipos combinados em todas as permutações, demais tipos, câmera/anexo/substituição/exclusão dos slots 6 e 7, sete blobs preservados, rascunho/reabertura/reload, blobs assíncronos e isolamento por UUID. Em Correção Solicitada, substituir 6 ou 7 gera somente o evidencePatch correspondente; fotos 1–5, outro Trafo, serviços, materiais, observação, pedido, histórico e UUID permanecem preservados. Ausência de alteração não enfileira nem produz falso CORRIGIDO.

A etapa de dados continua aceitando zero fotos. A validação final continua exigindo pelo menos três fotos gerais e ambas as evidências de Trafo. A suíte anterior conserva a comparação de isolamento, admitindo somente as duas linhas visuais, verificadas separadamente contra o HEAD inicial.

As regras anteriores para os dados do transformador quando o tipo é desmarcado permanecem iguais. As fotografias e seus blobs não são apagados pela mudança de tipo; os valores nos controles retornam ao registro ao remarcar Trafo no formulário aberto.

## Limites

iPhone/Safari, Android, câmera e seletor nativos e computadores físicos: **NÃO VALIDADO FISICAMENTE**. O harness verifica atributos, ancestrais, eventos, índices e configuração existente de arquivo/câmera; não simula layout físico nem dispositivos nativos. Nenhum login operacional, ocorrência real, reenvio, aprovação ou alteração de dados de produção foi usado para QA.

A publicação utiliza o workflow existente `.github/workflows/pages.yml` no push de `main`. Release, imports e cache do Service Worker foram atualizados de forma coordenada, preservando a atualização protegida da PWA.
