# Pós-login do Supervisor: referências frias de fotos em lote

Quando o cache de referências expirava ou era removido pela plataforma, a primeira lista consultava o Drive sequencialmente para cada foto. No conjunto medido, 186 verificações consumiram 50,819 s de uma execução interna de 54,226 s (medianas de três amostras).

O patch incremental `patches/backend-supervisor-photo-batch-20261007.patch` aplica-se ao fonte oficial privado `2026.10.06.3` de `ApprovalIntegrity20260911.gs`. Atualiza o backend para `2026.10.07.1`, mantendo o contrato v12. O fonte completo, com configuração privada, não pertence ao repositório público.

Somente `listPending_` habilita a resolução das referências ausentes: até 100 metadados por lote e quatro lotes paralelos. A confirmação exige HTTP 200, correlação do ID solicitado e permissão `anyone` com `allowFileDiscovery === false`. Metadados incertos, privados, ausentes ou falhas mantêm o fallback preexistente de `ensurePhotoPublic_`. Confirmações usam o cache de referências existente, com o mesmo TTL de 21.600 s; não há cache operacional novo. Nenhuma imagem é baixada pelo lote.

| Medição real no editor | Amostras, ms | Mediana, ms |
| --- | --- | --- |
| Antes, cache vazio forçado | 54.226 / 50.823 / 56.708 | 54.226 |
| Candidato em lote, cache vazio | 2.365 / 722 / 769 | 769 |
| Integração final, cache vazio | 719 / 642 / 657 | 657 |
| Cache cheio, controle original na mesma execução da integração | 819 / 257 / 263 | 263 |

Redução de **98,79%** da execução interna no cenário frio reproduzido. O profiler só fez leituras e suprimiu as gravações do cache de referências; essa gravação não está no tempo medido. As três amostras de cada grupo compartilham uma execução e podem aproveitar caches internos do Apps Script. O cache real estava cheio durante o diagnóstico, portanto não é possível afirmar que estava vazio no incidente do usuário. O resultado não mede transporte HTTP nem pintura do Safari.

Resposta real preservada byte a byte: 417.580 bytes, 29 registros de conferência, 8 pendências e 132 resumos de métricas. SHA-256 `c6938b1aed9aea85d6e866803d80eae096f503ad8240dfbb4a7d9844f607bb2f`. Uma abertura de planilha e dois ranges operacionais permanecem iguais. Autenticação, regras de negócio, snapshots, UUID, filtros, Campo, fotos e frontend permanecem inalterados.

Validação: **22 suítes, 687 casos numéricos e três grupos integrados**, todos aprovados. A nova suíte tem 23 cenários de cache, API, permissões, falhas parciais, segurança da correlação, limites de lote e preservação das demais funções. Testes de UI/API usam mocks e não fazem login operacional. O protocolo T0–T11 foi repetido com o mesmo frontend e mocks de 0/500/15.000 ms; uma request principal, dependências secundárias não bloqueantes e encerramento do loading permanecem validados. Sem Safari físico.

Publicação em 07/10/2026 às 08:46 (Bahia): mesmo projeto, mesmo deployment/endpoint, **versão de implantação 28**. Nenhuma ampliação de acesso público do deployment. O consentimento administrativo Google para chamadas externas foi concluído pelo usuário. Instrumentação executável temporária removida antes da implantação; arquivo temporário contém somente um comentário. Frontend/SW/cache continuam `2026.10.06.5`.

Para reproduzir a nova suíte com cópias autorizadas dos fontes privados:

```sh
node tests/supervisor-photo-batch.mjs /caminho/backend-after.gs /caminho/backend-before.gs
```

Referências oficiais: [Drive batch](https://developers.google.com/workspace/drive/api/guides/performance), [metadados e limitações de permissions](https://developers.google.com/workspace/drive/api/reference/rest/v3/files), [UrlFetchApp](https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app).
