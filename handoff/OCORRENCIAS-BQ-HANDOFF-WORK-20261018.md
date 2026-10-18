# Auditoria backend e segurança — Ocorrências B&Q — 18/10/2026

## Estado e limites da evidência

- Checkpoint Git: `1ec0f688f76f1140c0300f2ab70b68b6d2c75915`.
- O repositório contém três módulos aditivos públicos (`backend/*.gs`) e patches incrementais. **Não contém a fonte integral `ApprovalIntegrity20260911.gs`, o roteador completo, o verificador de tokens, o mecanismo completo de publicação nem as integrações privadas.**
- O coordenador confirmou o health oficial `2026.10.15.4`, contrato v12, no `/exec` existente; identificou no Drive o projeto nativo `OCORRÊNCIAS B&Q — Backend`. A extração da fonte pela conexão Drive foi bloqueada com HTTP 403. Nenhuma credencial Google está disponível no ambiente. Histórico documental de versão de deployment não substitui verificação atual da API/editor.
- Este trabalho só modificou código local e fixtures. Não houve login operacional, gravação em planilhas/Drive reais, mudança de credenciais, limpeza, alteração de deployment ou publicação backend.
- Os defeitos abaixo estão comprovados nos módulos públicos atuais; sua presença no código ativo precisa ser conferida no editor oficial antes da implantação. Não afirmamos que o patch foi aplicado em produção.

## BACK-01 — P1 — Transferência perde intenção de fotografia ainda não confirmada

**Fluxo:** Fiscal envia dados → upload escreve URL/chave com recibo `STAGED` → falha antes da confirmação → conta mestra transfere a correção.

**Causa:** `reassignFiscalCorrection_` calculava os slots restantes somente por URL existente e `uploadKey` igual. O pipeline grava esses campos antes de promover o recibo da foto de `STAGED` a `COMPLETE`. Assim, a transferência removia `lastCorrectionSubmission` e arquivava o recibo sem repor esse slot em `requestedPhotoIndexes`. Também falhava quando a URL da linha divergia de `receipt.expectedUrl` com a mesma chave.

**Reprodução:** fixtures com recibo de dados `DATA_VERIFIED`, foto `STAGED`, URL/chave presentes, seguidas de transferência Fiscal A → Fiscal B. No baseline, slot 1 não fica solicitado. Em uma segunda fixture, URL divergente com chave igual também desaparece da solicitação. O helper real `photoSlotConfirmed_`, extraído do patch de persistência existente, recusa as duas situações.

**Correção:** reutilizar `photoSlotConfirmed_(found.values, audit, index)` e conservar a comparação com a chave declarada no delta. Recibos arquivados, UUID, dados já gravados, URLs e chaves são preservados. Não há novo mecanismo de correção nem migração.

**Arquivo/função:** `backend/FiscalCorrections20261015.gs`, `reassignFiscalCorrection_`.

**Regressão:** foto `STAGED`, URL divergente, URL ausente, chave divergente, fotos confirmadas nos slots 1/5/6/7, preservação de outro UUID, revisão obsoleta, destinatário anterior recusado e repetição idempotente.

## AUTH-01 — P1 — Revogação durante I/O não impede resposta de consultas fiscais

**Causa:** `listFiscalRecords_`, `listFiscalCorrections_` e `getOccurrenceDocument_` autenticavam antes das leituras. Uma conta desativada ou cuja revisão/Bases mudasse durante o I/O ainda recebia os dados calculados com a autorização anterior. Fotos e resumo operacional já revalidavam antes de retornar; essas três consultas não seguiam a proteção existente.

**Reprodução:** um hook do serviço Sheets troca a revisão/Bases após começar a leitura, ou um hook da construção documental altera a conta durante o carregamento de serviços/materiais. Os três endpoints do baseline retornam o conteúdo. As fixtures não exploram produção e não usam tokens reais.

**Correção:** repetir `requireSession_` antes da resposta; no documento, repetir também `authorizeDocumentRow_`. A revisão antiga é recusada com `AUTH_REQUIRED`. A lista de correções devolve a ACL revalidada. Não há cache compartilhado novo, privilégio novo ou enfraquecimento de validações.

**Arquivos/funções:** `backend/OperationalFeatures20261014.gs`, `listFiscalRecords_`/`getOccurrenceDocument_`; `backend/FiscalCorrections20261015.gs`, `listFiscalCorrections_`.

**Limite:** o harness usa handles de sessão sintéticos e as funções públicas de conta/revisão; não valida assinatura, expiração, revogação Campo/Supervisor ou roteador privado. Esses controles exigem a fonte oficial e as suítes originais.

## PERF-01 — P2 — Leituras repetidas de propriedades na lista Fiscal

**Causa:** cada `fiscalCorrectionProjection_` verificava duas vezes o mesmo destinatário e cada verificação relia `FISCAL_ACCOUNTS_V1`.

**Medição determinística em fixture de 25 correções:** baseline 51 leituras da propriedade; candidato 3. Ambas fazem uma leitura da planilha. As 3 leituras finais incluem autenticação inicial, snapshot único das contas e revalidação final da sessão. São 48 chamadas de propriedades evitadas nesse cenário; **não há medição de ganho em segundos, latência real, mediana ou p95 de produção**.

**Correção:** snapshot local da conta somente durante a operação, parâmetro opcional compatível nos helpers e uma única avaliação do destinatário por projeção. A autorização de escrita continua relendo as contas atuais; o snapshot só atende a projeção de leitura.

**Funções:** `fiscalCorrectionCandidates_`, `fiscalCorrectionRecipientValid_`, `fiscalCorrectionProjection_`, `listFiscalCorrections_`.

## Testes e artefatos

- `node tests/audit-backend-20261018.mjs`: **26/26 aprovados**, 0 falhas, 0 writes em produção.
- Mesma suíte com os módulos do checkpoint (`--modules-dir=/workspace/scratch/backend-before`): **20/26**, seis falhas reproduzidas, referentes aos três defeitos acima.
- `node --check tests/audit-backend-20261018.mjs`: aprovado.
- `git diff --check`: aprovado.
- `git apply --check patches/backend-audit-20261018.patch` e aplicação: aprovados **somente em uma concatenação isolada dos módulos públicos do baseline**. Isso valida a construção do patch; não prova aplicabilidade na fonte privada atual.
- Modo `--official-source=ARQUIVO.gs` da suíte: extração das funções correspondentes testada em concatenação pública isolada, **26/26**. A execução sobre a fonte oficial privada continua pendente.
- Evidências: `/workspace/scratch/backend-before.json`, `backend-after.json`, `backend-extraction-check.json`.
- Patch revisável: `patches/backend-audit-20261018.patch` (destino `ApprovalIntegrity20260911.gs`). Os números de linha referem-se à concatenação pública; aplicar somente após `git apply --check`/comparação contextual com a fonte oficial.
- Arquivo auxiliar de substituição: `/workspace/scratch/backend-audit-replacements-20261018.gs`. Contém somente as sete funções alteradas; **substituir as funções existentes, não adicionar arquivo com definições duplicadas**.

## Cobertura de segurança efetivamente exercitada

Sessão fiscal com revisão antiga; conta inativa; mudança de Base; recusa de Campo/Supervisor/Fiscal comum na administração; cliente tentando promover conta por payload; CAS de revisão de cadastro; revalidação após lock; Base não autorizada; destinatário/revisão de atribuição; Campo recusado em correção fiscal nova; autorização de upload por slot/chave/recibo de dados; duplicidade de UUID na transferência; preservação dos demais UUIDs durante transferência em fixtures.

Nenhuma evidência nesta etapa confirma aprovação/publicação, exclusão, login Campo/Supervisor, rate limiting, assinatura de tokens, headers e integrações privadas completas. Não são cenários aprovados por este subrelatório.

## Handoff obrigatório para implantação oficial

1. Abrir **o mesmo projeto** `OCORRÊNCIAS B&Q — Backend`, já identificado no Drive, e obter fonte e manifesto atuais em diretório privado. Registrar versão, deployment, hash SHA-256 e endpoint antes do write; não copiar configuração privada ao repositório público.
2. Comparar as sete funções atuais com o patch. Se houve evolução compatível, portar apenas as alterações correspondentes; não substituir o projeto inteiro pelos módulos públicos. Se o defeito já estiver resolvido na fonte ativa, preservar a correção existente e registrar a divergência.
3. Aplicar `patches/backend-audit-20261018.patch` sobre uma cópia privada de `ApprovalIntegrity20260911.gs`, conferindo `git apply --check` antes. Se os offsets/contextos divergirem, usar as sete substituições revisáveis do arquivo auxiliar após comparação, sem forçar aplicação.
4. Executar as suítes com a fonte candidata privada (comandos abaixo) e a nova suíte com `--official-source`. Os mocks não devem atingir endpoints/planilhas reais. Não publicar se houver falha, dupla definição de função ou regressão de roteamento `LEGACY_FIELD`.
5. Atualizar apenas a versão declarada do backend para uma release coerente, proposta `2026.10.18.1` se ainda disponível. Preservar contrato v12, configuração, propriedades, arquivo auxiliar, manifesto, integrações, schemas e `/exec`.
6. Salvar no projeto oficial, criar versão e **atualizar o deployment existente**. Não criar novo projeto, planilha ou endpoint. Essa ação já está autorizada pelo proprietário no escopo; o acesso Google é o bloqueio, não falta de autorização.
7. Validar health somente leitura no mesmo `/exec`, registrar versão e resposta; devolver deployment/version number, hash da fonte final e resultados das suítes. Comparar frontend publicado e contrato backend. Não fazer gravações operacionais de QA em produção.

```bash
node tests/audit-backend-20261018.mjs --official-source=/caminho/privado/BACKEND_CANDIDATO.gs
node tests/fiscal-corrections.mjs /caminho/privado/BACKEND_CANDIDATO.gs
node tests/fiscal-admin.mjs /caminho/privado/BACKEND_CANDIDATO.gs
node tests/operational-features.mjs /caminho/privado/BACKEND_CANDIDATO.gs
node tests/correction-persistence.mjs /caminho/privado/BACKEND_CANDIDATO.gs
node tests/field-historical-correction.mjs /caminho/privado/BACKEND_CANDIDATO.gs
node tests/publication-reconciliation.mjs /caminho/privado/BACKEND_CANDIDATO.gs
node tests/hotfix-sync-publication.mjs /caminho/privado/BACKEND_CANDIDATO.gs
```

**Reversão:** selecionar novamente a versão anterior no mesmo deployment, mantendo `/exec`; não reverter dados ou planilhas. Conservar o checkpoint do código anterior em diretório privado. As alterações candidatas não migraram dados e não exigem limpeza.

**Aceite:** 26 testes novos e suítes privadas aplicáveis aprovados; foto não confirmada segue solicitada após transferência; fotos confirmadas não são reenviadas; ACL revogada durante leitura não recebe conteúdo; perfis e legado conservados; health declara a versão implantada no deployment original. Até receber essas evidências, backend permanece **candidato validado localmente, implantação pendente**.

## Checkpoint e frontend já preparado

Fonte frontend da release 2026.10.18.1: commits d9fb824, accff41, a227bd4, 95da921 e a59f9b5; candidato backend 44321d3; regressão/CI 0ce568a. PR oficial #9, merge 0d238849dc09f8384d938f27050007d74b723cb3, integrado em 18/10/2026. O resultado do Pages e os hashes servidos constam do relatório final e de verification/audit-production-final-20261018.json; não inferir implantação a partir deste checkpoint Git.

O frontend utiliza o backend v12 atual e não depende da aplicação dos três patches backend candidatos. Não republicar frontend antigo para aplicar o backend. O ZIP contém o repositório público, testes e evidências; não contém a fonte integral privada, tokens ou dados operacionais.

Reversão frontend: preservar o código/commit anterior e publicar nova release com os arquivos anteriores e um NOVO identificador de cache. Nunca limpar IndexedDB/Blobs para reverter código e não usar force push. A reversão backend seleciona a versão anterior no mesmo deployment sem alterar /exec ou reverter dados.

Na devolução ao Codex, incluir: hash do fonte ativo anterior e final, funções efetivamente diferentes, versão declarada, número de versão Apps Script, deployment preservado, health v12, resultados das oito suítes privadas e da suíte nova --official-source. Se uma função já estiver corrigida no fonte atual, registrar e preservá-la; não reaplicar o defeito nem presumir que o módulo público seja todo o projeto.
