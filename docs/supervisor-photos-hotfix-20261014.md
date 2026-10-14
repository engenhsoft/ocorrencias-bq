# Hotfix de visibilidade e fotografias — 14/10/2026

Frontend `2026.10.14.3`. Backend `2026.10.14.2`, Apps Script 32, preservado.

## Não conformidade somente no Supervisor

O componente já ficava dentro da área do Supervisor e o backend já limitava seus dados ao perfil. Porém, a navegação interna aceitava ativar essa área com sessão Campo, e o bloco estático não tinha controle próprio de perfil. Um evento de navegação interno reproduz essa lacuna.

`navigate` agora recusa a área Supervisor para outros perfis. `nonconformitySection` começa fechado e somente é ativado e preenchido quando o perfil e a área são Supervisor. Reset, logout, troca de perfil e saída da área removem o conteúdo e o espaço. O resumo do Campo continua trazendo somente TOP 3; Fiscal não carrega resumo global. Fórmula, fonte, períodos, agrupamentos, TOP 3 e gráfico por Base permanecem preservados.

## Fotografias

Foram reproduzidas três falhas de frontend:

- A consulta usava `previewUrls`, indexado somente pelo slot, como fallback mesmo para outro UUID. O rascunho atual podia preencher indevidamente uma foto ausente de outra ocorrência, inclusive Trafo 6/7. `recordPhotoUrl` restringe preview ao Campo, rascunho atual, UUID, slot e uploadKey correspondentes. No rascunho, a foto substituída aparece antes da referência remota antiga; consultas usam a referência do estado atual.
- `syncRequestedPhotos` exigia o registro local antes de consultar o servidor. Um aviso desatualizado falhava em outro aparelho mesmo com todas as fotos já confirmadas. Agora a confirmação remota vem primeiro; UUID, responsável, slots esperados e evidências Trafo são verificados. Fotos realmente faltantes continuam exigindo os blobs corretos no aparelho responsável.
- `syncAll` emitia mensagem de sucesso genérica com falhas parciais. Agora informa quantas ocorrências foram sincronizadas e quantas continuam pendentes, sem interromper os demais UUIDs.

O upload, confirmação por uploadKey, descarte condicionado de blob, recibos, fingerprint, requestId, expectedPatch, beforePatch, persistência e regras de status não foram modificados. Não há novo endpoint, polling ou worker. Não houve login operacional, upload de QA ou alteração de ocorrência real.

## Validação

425 checagens contadas aprovadas, zero falhas finais, zero ignoradas; três grupos adicionais de integração concluíram. Inclui 23 testes novos com prova dos comportamentos anteriores, criação/retomada, correção textual/fotográfica/mista, resposta perdida, duplicação, arquivo ausente, reconexão, reabertura, solicitações e isolamento por responsável.

O navegador local com dados sintéticos confirmou desktop 1440 px e mobile 390 px: Campo/Fiscal/login sem taxa, Supervisor com taxa e filtros, troca de perfil, reload, logout e nenhuma exceção de página. Safari/iPhone físico e blobs do aparelho original dependem do operador.

Reprodução dos testes novos:

```bash
git show 70e901f:app.js > ../app-before.js
git show 70e901f:operational-features.js > ../features-before.js
node tests/supervisor-photos-hotfix.mjs ../app-before.js ../features-before.js
node tests/photo-sync-notice.mjs
node tests/features-ui.mjs BACKEND_PRIVADO_V32.gs
node tests/pwa-release.mjs
```

Os erros foram comprovados no código e em fixtures. Não foi fornecido um novo UUID problemático neste pedido; não se afirma que esses achados expliquem toda falha possível em aparelhos reais. Uma leitura pontual confirmou a ocorrência 16710 aguardando conferência e a Foto 1 com recibo COMPLETE; sua referência respondeu como JPEG. Não foi reenviada essa ocorrência.
