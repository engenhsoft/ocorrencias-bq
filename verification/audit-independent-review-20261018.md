# Revisão independente dos patches de integridade — 18/10/2026

Revisão inicial READ-ONLY do diff contra `1ec0f68` de app.js, db.js, fiscal-drafts.js, fiscal-workspace.js e módulos backend públicos. Três condições concretas reproduzidas e enviadas cedo ao agente principal.

## REV-01 — Falso conflito no terceiro autosave da mesma aba

Interleaving comprovado na função real `saveActiveDraft`, com armazenamento/método meta controlados:

1. Saves A e B enfileirados com versão T0.
2. A grava T1, atualiza activeRecord.updatedAt e aguarda sua gravação de meta.
3. C começa com versão ativa T1 enquanto a Promise de B ainda declara expected T0.
4. O cálculo `followsPrevious` de C é falso. B grava T2; C envia expected T1 e rejeita `LOCAL_RECORD_CHANGED`.

Resultado: disco conserva edição B; edição C permanece somente na memória, apesar de nenhuma alteração externa. Agente sync_integrity recebeu evidência e assumiu correção com regressão de ancestralidade da fila. Não foi alterada essa função por este agente.

## REV-02 — P1 — Dados de Minhas Ocorrências na sessão seguinte

Reprodução anterior: Campo A inicia `handleMineAction(view)` e aguarda `getRecord`; após troca para Campo B, liberar a leitura de A abre o detalhe com a observação de A na sessão B. Os ramos correct/resume também abriam formulário, gravavam metadados e mostravam mensagens após troca/logout.

O agente principal autorizou alteração exclusivamente de `handleMineAction`. Foram acrescentados snapshot de sessionRevision/token e verificação após cada await anterior a UI/meta/carregamento de formulário. O registro de correção já iniciado continua preservado no aparelho; seu retorno não altera a sessão nova.

Arquivos: `app.js:handleMineAction`, `tests/audit-mine-session-20261018.mjs`.

Reprodução de regressão antes: 9 cenários, 3 aprovados, 6 falhos; depois: 9 aprovados, 0 falhos. Evidências `/workspace/scratch/mine-session-before-20261018.json` e `/workspace/scratch/mine-session-after-20261018.json`. O teste cobre leitura tardia em view/correct/resume, gravação tardia, meta tardia, correção normal preservando revisão persistida e propagação do erro atual ao tratamento existente. Sem rede ou dados reais.

`loadRecordIntoForm` inspecionada sem alteração: guarda revisão/token após consulta remota da correção; guarda identidade do objeto activeRecord depois da leitura de fotos; troca/logout chama resetForm e invalida esse objeto. `node --check app.js`, `git diff --check` dos arquivos próprios e `tests/operational-stability.mjs` (9/9) aprovados após o patch.

## REV-03 — Foto tardia ressuscita rascunho excluído em outra aba

Reprodução com db.js atual e fake-indexeddb real, sem mock de armazenamento:

1. Tab A mantém cópia do rascunho T0 e prepara uma foto.
2. Tab B executa deleteRecord com expectedUpdatedAt T0 e status RASCUNHO; exclusão confirma.
3. Tab A termina a otimização e chama putPhotoAndRecord com a cópia T0.
4. A transação encontra current ausente e o código escreve novamente record+photo.

Resultado observado: `recreated: true`, `photos: 1`. A guarda isCurrent da Tab A não detecta a exclusão da outra aba. Comunicação enviada a sync_integrity e principal para tratar na própria transação; nenhuma edição minha em db.js/fiscal-drafts.js.

## Observações de menor gravidade comunicadas

`openAssignedFiscalCorrection` usa session.aclRevision após await storage.getRecord e session.bases após await loadRecordIntoForm sem nova verificação nesses pontos. Logout durante esses awaits pode produzir TypeError ou mensagens tardias. Enviado ao principal/sync; fora da propriedade de edição deste agente.

A revisão dos demais diffs não comprovou outro defeito. Isso não equivale a validação do Apps Script privado, ausente do repositório/contexto, nem dos fluxos reais em produção.
