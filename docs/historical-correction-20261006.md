# Correção de serviços históricos — 2026.10.06.2

Corrigir PG ou outro campo de uma ocorrência existente e reenviá-la agora conserva os serviços salvos. Alterar a quantidade mantém o valor unitário histórico; adicionar, substituir ou remover e selecionar novamente um serviço usa o catálogo atual.

## Causa confirmada

O aviso `O serviço 1 diverge da aba Emergência. Pesquise novamente.` era lançado por `validateCatalogService_`, no Apps Script. `submitRecord_` chamava `validateAndNormalizeRecord_` sem o registro original, antes de procurar o UUID salvo. Assim, todos os serviços passavam pela validação da posição atual do catálogo, inclusive linhas históricas não editadas. O frontend também reprecificava listas com `contractValues` ao abrir o formulário.

## Patch

- O backend identifica o UUID, verifica o proprietário e obtém os serviços salvos, dentro do bloqueio existente, antes de validar uma atualização.
- O modo `fieldEdit` reutiliza `servicesForSupervisorEdit_`: mesma linha e mesma identidade/preço preservam o objeto original do servidor; quantidade alterada recalcula somente aquela linha; outras seleções consultam `validateCatalogService_`.
- O frontend conserva `audit.pendingServices` como referência inicial, usa `historicalServiceIndex` por linha e mantém totais históricos em `occurrenceSnapshotTotal`.
- Linhas legadas sem `lineId` recebem um ID estável apenas para edição. Uma nova seleção recebe UUID novo, inclusive quando tem o mesmo código.
- Validações estruturais, autenticação, propriedade, quantidade positiva, totais finitos e contratos continuam obrigatórias. Uma marca histórica enviada pelo cliente não substitui a comparação com o registro salvo no servidor.
- Seleções novas continuam usando H para `4600080938` e I para `4600080939`.

O patch não modifica catálogo ou planilhas de serviços, não migra dados históricos e não recria ocorrências. Materiais, fotos, fila, UUID, número e ciclo de aprovação usam os mecanismos existentes. A atualização mantém o endpoint oficial e versiona frontend/cache/backend como `2026.10.06.2`.

## Validação

199 testes passaram: 49 de correção em Campo, 40 de snapshots/aprovação, 16 de contratos, 17 de quantidades decimais, 9 de estabilidade operacional e 68 de publicação/reconciliação. O teste de versão/cache PWA também passou.

A suíte nova cobre PG, serviço removido, preço/descrição/chave alterados no catálogo, quantidade histórica, linhas mistas, substituição, reseleção do mesmo código, múltiplos serviços, retomada de rascunho, legado sem ID, dados inválidos, acesso por outro usuário, pedido de foto pendente e aprovação após reenvio. Uma fixture operacional externa foi capturada por leitura e executada apenas em memória; ela não faz parte do repositório.

```bash
node tests/field-historical-correction.mjs /caminho/privado/backend.gs
node tests/service-snapshot-approval.mjs /caminho/privado/backend.gs
node tests/contract-pricing.mjs
node tests/login-supervisor-decimal.mjs
node tests/operational-stability.mjs
node tests/publication-reconciliation.mjs /caminho/privado/backend.gs
node tests/pwa-release.mjs
```

Sem a fixture operacional opcional, a suíte nova executa 48 casos sintéticos. A fixture pode ser fornecida como terceiro argumento; o quarto argumento permite testar fontes frontend anteriores.

## Backend

`patches/backend-historical-correction-20261006.patch` contém apenas o delta sobre o backend `2026.10.06.1`. O fonte integral privado não é publicado neste repositório. Aplique o patch ao arquivo `ApprovalIntegrity20260911.gs` e atualize a implantação oficial existente.
