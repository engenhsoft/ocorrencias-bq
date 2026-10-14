# Hotfix de releitura de identificadores — 14/10/2026

Frontend/backend `2026.10.14.1`, contrato v12 e infraestrutura original preservados.

O estado inicial era main `0d123a7f83c965c955523dbbae4b8f51b3f7668a`, frontend `2026.10.12.2` e Apps Script `2026.10.07.3`, versão 30. O fonte oficial foi preservado antes do patch. Não houve alteração de dados operacionais para QA.

## Causa e correção

O Sheets relê Série, CIA, BTO e outros identificadores numéricos como números. O comparador da linha persistida normalizava somente o contrato. Uma linha gravada corretamente era rejeitada por diferença de tipo, antes do upload de fotografias; no reenvio, o recibo permanecia STAGED.

`pendingPersistenceSnapshot_` agora converte explicitamente as doze colunas de identificadores para sua representação textual exata. Isso aceita `123456` numérico versus `"123456"` textual, mas continua rejeitando `"0123456"` versus `123456`, valores diferentes e demais divergências da linha. As duas releituras limitadas, os fingerprints, os recibos e a confirmação dos slots permanecem obrigatórios. Nenhum timeout foi aumentado.

O retry mantém UUID, data original, serviços, materiais, histórico, uploadKey e blobs. Uma correção STAGED reaproveita o mesmo recibo e só termina depois da releitura válida e das fotos pertinentes. O teste com cinco fotos gerais e duas evidências conclui o upload dos sete slots sem repetir o data commit.

## Verificação

17 novos testes em `tests/identifier-readback.mjs` reproduzem os erros no fonte anterior e verificam a correção. A regressão inclui 27 suítes, 893 casos contados e três grupos integrados, sem falhas finais. Os testes usam código real com Sheets, Drive, DOM, rede e IndexedDB simulados.

Dois testes de isolamento da validação por etapas ainda comparavam HTML/CSS com um commit anterior ao acesso PROGRAMAÇÃO já publicado. O novo argumento `--isolation-baseline=0d123a7` compara esses arquivos com o estado inicial desta mudança, mantendo a reprodução histórica da validação. O teste de login aceita `--current-baseline` sem exigir a reprodução de uma falha histórica já corrigida.

Comandos principais:

```bash
node tests/identifier-readback.mjs BACKEND_CORRIGIDO.gs BACKEND_INICIAL.gs
node tests/correction-persistence.mjs BACKEND_CORRIGIDO.gs
node tests/correction-delta.mjs BACKEND_CORRIGIDO.gs BACKEND_2026.10.07.2.gs '' FRONTEND_1603921
node tests/stage-validation.mjs --isolation-baseline=0d123a7
node tests/pwa-release.mjs
```

O patch incremental é `patches/backend-identifier-readback-20261014.patch`. O fonte integral, que inclui configuração privada, permanece fora do repositório público. A versão anterior continua disponível no histórico do mesmo deployment.

Safari/iPhone, câmera e os blobs do aparelho original não foram inspecionados. A publicação do código não representa sincronização das ocorrências reais: a equipe deve retomar pelo aplicativo no aparelho que preserva os arquivos.
