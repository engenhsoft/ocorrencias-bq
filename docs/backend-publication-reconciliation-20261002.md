Uma aprovação interrompida podia deixar tabelas finais parcialmente gravadas. A tentativa seguinte substituía serviços e materiais inteiros, inclusive dados divergentes. O backend `2026.10.02.1` compara os destinos com o snapshot da pendência por UUID, completa apenas os registros ausentes e preserva conflitos para análise.

A aprovação individual, a seleção de várias ocorrências e a rota de reparo solicitado usam `reconcilePublication_`. O snapshot é preparado antes do lock. Dentro do commit, a origem é relida, os cinco conjuntos são inspecionados e qualquer divergência impede as escritas. Os itens são comparados como multiconjuntos, contando linhas idênticas. OCORRENCIAS e o evento final devem ter exatamente uma linha por identidade. A fila só perde sua origem após confirmar ocorrência, serviços, materiais e histórico; uma releitura final confirma a conclusão. Uma chamada repetida após perda da resposta retorna sucesso idempotente.

Assinaturas dos campos de negócio, sem carimbos de atualização:

```text
Serviço: UUID, código, descrição, unidade, quantidade, valor unitário,
         valor total, grupo, catalog_key
Material: UUID, código string, descrição, unidade, quantidade,
          campo MATERIAL e Nº OCORRÊNCIA associado
```

Comparações preservam zeros iniciais e textos históricos. Quantidades e valores são comparados numericamente sem arredondar a assinatura. Preços e atributos de serviços existentes vêm do snapshot, sem consulta ao catálogo atual. Um conjunto vazio de materiais é válido na publicação histórica; a regra operacional de exigir pelo menos um serviço permanece.

O carregamento do Supervisor mantém dois ranges operacionais e cache de fotos em lote. Uma cópia ainda pendente continua acionável enquanto a conclusão não foi confirmada, mesmo quando já há uma linha oficial. O frontend e a release PWA `2026.10.01.4` permanecem iguais. O limite da rota de lote continua em três UUIDs por resposta; a interface selecionada processa cada UUID pela mesma aprovação individual.

O patch é incremental sobre o fonte privado `2026.10.01.3`, cujo SHA-256 é `14177f5d63d00fbc0a5537e96217141f2ac41b466d25350f102ec1c8d1631031`. O fonte completo, credenciais e fixtures operacionais não fazem parte deste repositório.

```sh
node tests/publication-reconciliation.mjs /caminho/backend-candidato.gs \
  /caminho/fixtures-somente-leitura.json /caminho/backend-anterior.gs
node tests/service-snapshot-approval.mjs /caminho/backend-candidato.gs
node tests/initial-load-profile.mjs /caminho/backend-candidato.gs \
  /caminho/backend-2026.10.01.2.gs
```

O harness não faz chamadas externas. Injeta falhas após cada fase persistente, inclusive prefixos de itens, histórico, auditoria, retirada da fila e integração de transformadores. Dois workers com estado e lock em memória compartilhada verificam solicitações simultâneas cujo snapshot foi obtido antes do lock. As fixtures reais opcionais só são aprovadas nas cópias em RAM.
