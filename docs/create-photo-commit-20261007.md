# Hotfix: nova ocorrência e confirmação das fotos

Frontend `2026.10.07.1`; backend `2026.10.07.2`, no mesmo projeto, deployment e endpoint Apps Script. Contrato backend v12 mantido.

## Causa comprovada

`submitRecord_` reutilizava `assertCorrectionRow_` para uma nova ocorrência. A comparação JSON da linha inteira diferenciava o contrato enviado como string do mesmo contrato devolvido pelo Sheets como número. A linha já estava salva, mas a API devolvia `CORRECTION_PERSISTENCE_MISMATCH` e a mensagem de correção. O cliente saía no catch de `submitRecord`, antes de qualquer upload.

O harness reproduziu a conversão observada na consulta somente leitura: uma chamada `submitRecord`, zero uploads, cinco blobs locais preservados. Não havia exigência de fotos finais nessa comparação: slots vazios eram os valores esperados da fase de dados. A regressão foi o comparador estrito reutilizado em CREATE, com mensagem sem contexto.

## Patch

- Normalizar somente a representação string/número do contrato na comparação da linha persistida. Seu valor deve continuar igual; os demais campos e zeros à esquerda continuam protegidos.
- Informar o contexto `CREATE_DATA`, `PHOTO_SYNC` ou `CORRECTION_RESUBMIT` ao verificador. CREATE confirma a linha intermediária com o snapshot de serviços/materiais e slots esperados, sem exigir evidências finais ou tabelas de publicação.
- Permitir no máximo duas leituras, com flush entre elas, sem repetir escrita, espera ou polling.
- No retry, confirmar UUID, usuário, snapshot de dados e slots esperados. Quando já persistidos, seguir diretamente para as fotos. Correção sempre mantém o envio e a verificação de seu recibo.
- Preservar uploadKey, reconciliação, remoção do blob somente após confirmação, retry individual e regras de status existentes.
- Mostrar separadamente fotos locais e confirmadas no servidor, com erro específico de fotos em CREATE.
- Incrementar release e cache do PWA, sem alterar registro do SW ou IndexedDB.

## Verificação

`tests/create-photo-commit.mjs` executa o app, transporte e funções backend reais em VM, com planilha, Drive e armazenamento local simulados. Não escreve em produção.

São 24 cenários: reprodução anterior; data commit com zero fotos confirmadas; cinco uploads; falha no primeiro slot; segunda leitura válida; retry 3/5; resposta perdida; idempotência do uploadKey; reload e Sincronizar tudo; blob ausente; divergências reais de oito campos; photo commit incompleto; contrato divergente; contagem da UI; metadados esperados incompletos; correção com fingerprint/COMPLETE; funções de negócio e lote protegidas.

A regressão completa passou em 23 suítes, com 711 casos contados e três grupos integrados adicionais. As suítes de correção, publicação/reconciliação, serviços históricos, quantidades decimais, materiais, login, Supervisor, fotos, offline, retry e idempotência permaneceram aprovadas.

O estado físico do IndexedDB do celular do usuário não foi inspecionado. O harness comprova a retomada dos blobs preservados; se um blob estiver realmente ausente, o aplicativo deve identificar a foto e manter a ocorrência pendente. A ocorrência real foi usada somente como referência de leitura, sem alteração manual ou QA de gravação.
