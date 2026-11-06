# Hotfix de identidade UTF-8 e retomada — 06/11/2026

O Apps Script oficial gerava o payload dos tokens Campo/Supervisor com a sobrecarga de Base64 sem charset. A reprodução nativa confirmou substituição dos caracteres acentuados por `?`. Fiscal já usava UTF-8. O nome retornado pelo login podia, portanto, diferir do nome assinado e posteriormente persistido na ocorrência.

## Alterações

- `createToken_()` usa `Utilities.Charset.UTF_8` em todos os perfis.
- `verifyToken_()` decodifica o Blob com a string `'UTF-8'`, conforme a API nativa; o enum de Base64 não é um charset válido para esse método.
- HMAC, segredo, expiração, ACL Fiscal, `requireSession_()`, `sameUser_()` e `assertOwner_()` permanecem iguais. Tokens válidos anteriores continuam sendo verificados sobre seus bytes originais.
- `sessionIdentityMatches()` verifica a consistência entre a sessão local e o payload UTF-8. Essa verificação não substitui a autorização nem verifica a assinatura no navegador.
- `readSession()` pede novo login quando há divergência de identidade ou perfil. Não modifica localStorage, IndexedDB, rascunhos, Blobs ou uploadKeys. O login normal substitui a sessão após autenticação.
- Release frontend `2026.11.06.1`, build `2026-11-06-identidade-utf8`, com imports e Service Worker versionados. Não há mudança de esquema IndexedDB nem limpeza de dados pessoais.

## Apps Script publicado

- Projeto existente: `1S65w-vU8SNGI3XsrWjZl609yEu4uQRhRrnQrlnI1bSWg1Gyy_xvup94z`.
- Versão anterior: 43, backend `2026.10.30.1`.
- Nova versão: **44**, backend **2026.11.06.1**, confirmada na interface de implantação e no health público.
- Deployment e endpoint preservados: `AKfycbyq_gRMEPzN7xImFqrx-g2mrZt1PCcC4_8RFOinhqONsnpyj6_OmauIPeXe7NGrA31f`.
- Contrato preservado: `OCORRENCIAS-BQ-CORRECTION-PERSISTENCE-v12`.
- SHA-256 do fonte principal antes: `ce372e139fc92c121b2c62677db62402c7ca788db4974786a8e9561e6a2e592b`.
- SHA-256 do fonte principal publicado: `3dd5d9b8ac43b9e4a5c2ebb8882a782b76d6a81f596d0f482953759f51d92265`.

O fonte privado completo e credenciais não são versionados neste repositório. O patch contém somente as duas funções e a atualização de versão. As rotinas temporárias de diagnóstico/manutenção foram removidas do editor e não integram a versão 44.

## Recuperação controlada

O inventário inicial encontrou 18 UUIDs com `?` no nome: 15 publicados e 3 na aba de pendentes. Os três estados eram, respectivamente, reprovado, correção solicitada e fotos em sincronização; a aba não prova bloqueio de fotos.

Foi reconciliado somente o UUID cuja identidade original estava explicitamente comprovada na instrução do proprietário autenticado. Os outros 17 registros permanecem sem substituição inferida. O inventário nominal, UUIDs, backup de células e auditoria são entregues de forma privada ao proprietário.

A manutenção exige backup, hash integral do registro anterior, UUID único, operador previamente verificado no editor Google, correspondência exata do defeito e ausência de fórmulas. Usa a trava do projeto, altera somente identidade e auditoria, ajusta o destinatário atual do pedido de fotos, preserva os atores históricos e acrescenta um evento de reconciliação. O retry não repete a escrita nem o histórico.

`maintenance/identity-reconciliation-20261106.gs` é material administrativo para o editor autenticado; não é importado pelo frontend nem exposto como rota. A identidade do operador é verificada externamente no editor, sem ampliar os escopos OAuth do aplicativo.

A releitura real confirmou serviços, materiais, valor, UUID, datas, status e slots preservados, com zero fotos confirmadas. O acesso de outro usuário continuou negado. A comparação independente das células confirmou mudanças somente nas colunas de usuário e auditoria do alvo e um novo evento de histórico.

O envio das fotos depende dos Blobs e uploadKeys no navegador original. Não foi criado novo UUID, feito upload fictício ou declarado sucesso sem confirmação real. O segundo caso de `DATA_COMMIT_CONFLICT` foi preservado: seus campos divergentes dependem da comparação com o rascunho original, indisponível neste ambiente. `dataCommitMatches()` e `dataCommitDifferences()` mantêm as verificações atuais e a revisão existente; não foi introduzida normalização especulativa.

## Verificação

- Reprodução nativa antes/depois no Apps Script: Campo, Supervisor e Fiscal.
- `tests/utf8-sessions.mjs`: 9 testes; ASCII compatível, UTF-8, tokens anteriores, expiração, assinatura e identidade sem curingas.
- `tests/session-identity.mjs`: 9 testes; sessão antiga exige renovação e os cinco Blobs/chaves permanecem no IndexedDB real de teste.
- `tests/identity-reconciliation.mjs`: 9 testes; autorização do operador, hash, backup, fórmula, duplicidade, preservação e retry.
- `tests/data-commit-reconciliation.mjs`: 22 testes; retomada sem reenvio de dados, diferenças legítimas, resposta perdida, concorrência e identidade reconciliada.
- Auditoria integrada: 174 testes aprovados em 13 suítes.
- Fonte oficial corrigido: 45 testes operacionais/login, 32 de correções Fiscal, 17 de administração Fiscal e 53 de persistência de correções aprovados.
- Regressões frontend, validação PWA e integridade estática executadas. A publicação usa o workflow existente de Pages; a comprovação final inclui o SHA do commit, conclusão do workflow e hashes dos assets servidos.

## Reversão

Manter a versão 43 como referência de reversão do deployment existente; ela reintroduz a causa de codificação e não deve ser usada sem regressão comprovada. Reverter frontend com novo identificador de cache, preservando IndexedDB. Não desfazer a reconciliação por substituição global ou sobrescrever uma ocorrência que tenha evoluído após o backup.
