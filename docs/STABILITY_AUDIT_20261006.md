# Estabilização de 6 de outubro de 2026

Frontend e backend: `2026.10.06.1`. Contrato, endpoint, UUID, estrutura das abas e fluxos operacionais existentes preservados.

Correções verificadas em código real com transporte, DOM, IndexedDB e serviços Google simulados:

- Deadlines cobrem fetch, corpo da resposta e leitura local da foto, inclusive quando abort é ignorado. Respostas incompletas não autorizam sucesso ou limpeza local.
- A reconexão inicia a fila sem aguardar o health check. Uma falha local por UUID permite continuar os demais itens.
- Gravações do sincronismo conferem a versão local; limpeza de blobs confere a uploadKey dentro da transação. Substituições novas são preservadas.
- A recuperação respeita uma confirmação remota existente e as decisões do Supervisor. Falhas no cache secundário não anulam a confirmação.
- Aberturas e transações locais têm prazo, e eventos tardios de uma conexão antiga não invalidam a nova. O resumo da fila lê registros e fotos em duas transações.
- Falhas nas ações locais assíncronas são exibidas ao usuário. Respostas e finally de operações do Supervisor pertencem à sessão que as iniciou; lotes param quando ela muda.
- Upload usa UUID, slot e uploadKey no nome do arquivo para retomar falhas após sua criação. A confirmação da linha é uma única gravação, e retry de reenvio de correção não duplica o evento de histórico.
- listMine mantém o payload, remove inspeções de cabeçalhos e consulta o cache de fotos em lote. Consultas de estado usam a busca já existente por UUID.
- O worker usa apenas o cache da própria versão, rejeita instalação com módulos de outra release e preserva HTML coerente enquanto uma atualização aguarda ativação.

O patch incremental do Apps Script está em `patches/backend-stability-audit-20261006.patch`. O fonte completo inclui configuração privada e permanece fora do repositório público. O patch deve ser aplicado ao fonte oficial `2026.10.02.1` do arquivo `ApprovalIntegrity20260911.gs`; não cria projeto nem deployment novo.

## Verificação

`tests/stability-audit.mjs BACKEND_GS [CHECKOUT]` cobre deadlines, payloads incompletos, concorrência local, fila com falha parcial, perda de resposta, troca de sessão, cache PWA e idempotência de upload. Nenhuma escrita operacional real.

`tests/profile-stability.mjs BEFORE_CHECKOUT AFTER_CHECKOUT BEFORE_GS AFTER_GS OUTPUT_JSON` mede cinco amostras comparáveis do Campo, fila local, consultas de backend, upload e recuperação. Todos os serviços são simulados; os tempos de CPU e as latências controladas não representam o Safari nem a rede real.

As suites anteriores de publicação, snapshots, contratos, materiais, filtros, KPIs, navegação, login e primeira carga também compõem a regressão. Os testes de publicação exercitam dois workers com lock compartilhado e falhas após etapas de commit.

Pendente de validação física: iPhone/Safari, câmera, instalação PWA, fechamento/reabertura e interrupção real da rede durante upload. A simulação não substitui esses ensaios.
