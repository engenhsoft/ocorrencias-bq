# Concluir CHAVES no mesmo Apps Script — 23/10/2026

A implantação já foi autorizada pelo proprietário. Falta acesso a uma ferramenta/credencial que atualize o deployment do Apps Script. A conexão Drive desta sessão exportou o fonte oficial, mas não publica deployments. Não há clasp/ADC configurado nem formulário seguro Google disponível nesta sessão. Não pedir senha no chat.

## Alvo e estado

- Repositório: `engenhsoft/ocorrencias-bq`; branch candidata: `feat/chaves-20261023`.
- Site: https://engenhsoft.github.io/ocorrencias-bq/ . A release visual independente está em `main`; CHAVES só deve entrar em `main` depois do backend.
- Projeto EXISTENTE: **OCORRÊNCIAS B&Q — Backend** — https://script.google.com/d/1S65w-vU8SNGI3XsrWjZl609yEu4uQRhRrnQrlnI1bSWg1Gyy_xvup94z/edit .
- Planilha EXISTENTE: `1dpbK_vJ7KNv1fFaLCxixB7jMBdVS-Q5FFjKVoUvXWH0` — Aplicativo Ocorrências.
- Deployment EXISTENTE: `AKfycbyq_gRMEPzN7xImFqrx-g2mrZt1PCcC4_8RFOinhqONsnpyj6_OmauIPeXe7NGrA31f`.
- Endpoint preservado: https://script.google.com/macros/s/AKfycbyq_gRMEPzN7xImFqrx-g2mrZt1PCcC4_8RFOinhqONsnpyj6_OmauIPeXe7NGrA31f/exec .
- Health observado: backend `2026.10.18.1`, contrato `OCORRENCIAS-BQ-CORRECTION-PERSISTENCE-v12`.
- Candidato backend/frontend CHAVES: `2026.10.23.3`, mesmo contrato v12.
- **Não houve alteração de fonte remoto, deployment, cabeçalhos ou registros operacionais nesta sessão.**

O fonte integral privado foi exportado do projeto oficial; não foi colocado no repositório público. O patch `patches/backend-chaves-20261023.patch` foi construído contra esse fonte e passou em `git apply --check`. Os hashes e os resultados ficam em `verification/chaves-20261023.json`.

## O que está pronto

- Quatro identificadores independentes, todos texto com até 80 caracteres: `pgKeyRemoved`, `btoKeyRemoved`, `pgKeyInstalled`, `btoKeyInstalled`.
- Seção imediata CHAVES no formulário Campo/Fiscal e no editor do Supervisor; seleção múltipla preservada.
- Rascunhos IndexedDB, navegação Dados → Fotos → Revisão, payload, normalização, consulta, correção, auditoria, PDF e Excel individual/múltiplo.
- Marcador persistente `formVersion=1` criado somente por `blankRecord()` para novas ocorrências. Registros/rascunhos anteriores ficam na versão zero. Abrir, corrigir ou alterar datas nunca promove a versão; o backend conserva a versão original em edições.
- CHAVES exige os quatro campos em versão 1. Um primeiro envio CHAVES sem marcador também é tratado como versão 1; versão zero explícita permite reenviar rascunhos anteriores à funcionalidade.
- Nenhum slot fotográfico novo. A etapa Dados não valida fotos; as três fotos gerais e as duas evidências de Trafo continuam nas etapas adequadas.
- Fingerprints legados mantêm a projeção anterior, inclusive recibos COMPLETE. `expectedPatch`, `beforePatch`, recibos e UUID são preservados. Remover CHAVES declara os códigos vazios sem tocar em PG de poste/condutor/trafo.
- Não há serviço faturável CHAVES, alteração de catálogo, fórmula financeira, filtros, perfis ou permissões.

## Procedimento exato

1. Autenticar o proprietário em interface Google segura do Work, se necessário. Abrir somente o projeto acima e registrar o deployment e o número da versão atualmente implantada. Exportar HEAD e manifesto para diretório privado e preservar uma cópia anterior.
2. Comparar SHA-256 de `ApprovalIntegrity20260911.gs` com `ae8411d5082269c682a879c067d730fe4cdd7467fe75a1e630bb15a47b892ce2`. Se divergir, comparar o contexto atual e portar apenas o delta de CHAVES, preservando commits/patches mais recentes. Não substituir o projeto inteiro pelos módulos públicos.
3. Sobre uma cópia privada, aplicar `patches/backend-chaves-20261023.patch` com `git apply --check` antes de `git apply`. O destino é o MESMO arquivo `ApprovalIntegrity20260911.gs`. Não adicionar definições duplicadas. Preservar `ProfileSupervisorReadOnly20261007`, manifesto, propriedades e credenciais existentes.
4. Executar as suítes abaixo sobre a cópia candidata, sem rede operacional. Devem passar antes do write no editor. A extração dos harnesses usa o fonte oficial completo e Sheets/Drive em memória.
5. Salvar o candidato no arquivo existente do projeto. Executar **uma vez `installChavesSchema_()`** no editor oficial. Esse helper usa o lock do mesmo projeto e faz preflight das DUAS abas antes de qualquer write. Verifica o prefixo original de 46 colunas, recusa conflito nas posições novas e acrescenta somente os cinco cabeçalhos em `AU:AY` das abas `OCORRENCIAS_AGUARDANDO_SUPERVISOR` e `OCORRENCIAS`. Não grava células de registros históricos. É idempotente.
6. Conferir que o helper devolveu `historicalRecordWrites: 0`; conferir os 46 cabeçalhos existentes intactos e apenas as cinco colunas novas abaixo. Não rodar bootstrap, backfill, migração de registros, função de recuperação histórica ou criação de planilha/projeto.
7. Criar uma nova versão do MESMO Apps Script e **editar o deployment existente** para essa versão. Preservar o `/exec`, o executor e as opções de acesso. Não criar endpoint paralelo. Registrar o número real da nova versão Apps Script e o hash final.
8. Consultar somente leitura `/exec?action=health`. Confirmar versão `2026.10.23.3` e contrato v12. Sem criar ocorrências de QA reais. Não liberar o frontend se essa confirmação falhar.
9. Atualizar a branch candidata com o `main` corrente, resolver apenas divergências reais e conferir HEAD/diff. Integrar o PR de CHAVES em `main` sem force push. O workflow Pages já inclui a regressão CHAVES do frontend e as suítes operacionais anteriores.
10. Aguardar workflow `SUCCESS`; conferir `core.js`, `app.js`, `index.html`, `styles.css`, exports e `service-worker.js` servidos com a release `2026.10.23.3`. Comparar SHA-256 com os arquivos do commit publicado e registrar o run/commit.
11. Devolver ao Codex: hash do fonte anterior/final, número da versão Apps Script, ID de deployment preservado, health, resultado do instalador aditivo, resultados das suítes e commit/run/hash dos assets frontend. Não enviar tokens, senhas ou fonte privado ao repositório público.

| Coluna nova | Cabeçalho | Campo |
| --- | --- | --- |
| AU / 47 | PG CHAVE RETIRADA | pgKeyRemoved |
| AV / 48 | BTO CHAVE RETIRADA | btoKeyRemoved |
| AW / 49 | PG CHAVE INSTALADA | pgKeyInstalled |
| AX / 50 | BTO CHAVE INSTALADA | btoKeyInstalled |
| AY / 51 | VERSÃO DO FORMULÁRIO | formVersion |

Os quatro códigos recebem formato texto antes das gravações de criação, correção Campo/Fiscal, edição direta do Supervisor e publicação. O histórico de aprovações mantém suas colunas atuais; os campos corrigidos são registrados na auditoria/recibos existentes.

```bash
# Executar na branch candidata. Os dois .gs ficam fora do repositório público.
node tests/chaves-core.mjs
node tests/chaves-backend.mjs /privado/ApprovalIntegrity20260911.candidate.gs /privado/ApprovalIntegrity20260911.baseline.gs
node tests/fiscal-corrections.mjs /privado/ApprovalIntegrity20260911.candidate.gs
node tests/fiscal-admin.mjs /privado/ApprovalIntegrity20260911.candidate.gs
node tests/operational-features.mjs /privado/ApprovalIntegrity20260911.candidate.gs
node tests/correction-persistence.mjs /privado/ApprovalIntegrity20260911.candidate.gs
node tests/field-historical-correction.mjs /privado/ApprovalIntegrity20260911.candidate.gs
node tests/publication-reconciliation.mjs /privado/ApprovalIntegrity20260911.candidate.gs
node tests/hotfix-sync-publication.mjs /privado/ApprovalIntegrity20260911.candidate.gs
node tests/service-snapshot-approval.mjs /privado/ApprovalIntegrity20260911.candidate.gs
node tests/chaves-ui.mjs /privado/ApprovalIntegrity20260911.candidate.gs
OCCBQ_BROWSER=webkit node tests/chaves-ui.mjs /privado/ApprovalIntegrity20260911.candidate.gs
```

As suítes arquivadas `identifier-readback.mjs` e `create-photo-commit.mjs` exigem, além do candidato, baselines históricos específicos para reprodução negativa. Não trocar esses baselines pelo fonte atual e declarar a reprodução aprovada. A cobertura atual de criação, fotos, texto com zeros, readback e idempotência está nas suítes acima e nas regressões obrigatórias do Pages.

## Reversão e preservação

Antes da liberação do frontend CHAVES, é possível voltar à versão anterior no mesmo deployment, mantendo os cabeçalhos aditivos. Depois que houver registros CHAVES, manter o leitor e a persistência dos novos campos; não voltar a backend que ignora CHAVES nem remover colunas. Corrigir adiante ou publicar frontend compatível que suspenda apenas a criação do novo tipo. Qualquer reversão frontend usa NOVO identificador de cache e preserva IndexedDB, Blobs, UUIDs e dados operacionais.
