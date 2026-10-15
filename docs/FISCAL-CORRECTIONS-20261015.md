# Correções atribuídas e indicadores do Fiscal — 2026.10.15.3

Novas solicitações seguem Supervisor → Fiscal responsável pela Base → correção → Supervisor, no mesmo UUID. Em **Fiscal → Correções**, o responsável abre o formulário operacional existente, consulta o motivo, altera dados/fotos e reenvia. O contador só é atualizado após confirmação do servidor. A consulta geral continua somente leitura.

## Atribuição e preservação

Uma Base com um Fiscal ativo tem atribuição automática. Com vários, a conta mestra indica um único principal em **Gerenciar fiscais**. Sem Fiscal ativo ou sem principal inequívoco, o pedido fica `WAITING_ASSIGNMENT`, com aviso ao Supervisor e atribuição/transferência pela conta mestra na aba Correções. Uma transferência preserva campos/fotos já confirmados e arquiva o recibo incompleto; o destinatário anterior perde a autorização. Atribuir novamente o mesmo responsável é idempotente.

Cada nova solicitação persiste `routingVersion: FISCAL_ASSIGNED`, identidade própria e revisão da atribuição. Ausência desse marcador significa `LEGACY_FIELD`. Não há migração. As quatro linhas antigas foram comparadas antes/depois nas 46 colunas e permaneceram idênticas, inclusive proprietário, status, motivo, fotos, chaves e auditoria.

A gravação valida sessão ativa, ACL atual, UUID existente, Base, pedido, revisão e destinatário sob lock. Fiscal não cria ocorrências, aprova ou publica. Rascunhos e blobs fiscais ficam no store `meta` existente, separados por usuário + UUID + pedido + revisão; não alteram records/photos do Campo nem a versão do IndexedDB.

Fotos gerais 1–5 e evidências Trafo 6/7 mantêm UUID + slot + uploadKey. O recibo de delta e a releitura impedem conclusão com evidência pendente. Retry conserva chave, arquivo, recibo e histórico. O Campo pode continuar o sincronismo formal de fotos originais ausentes, inclusive retry após resposta perdida, sem concluir a correção do Fiscal. Fotos que existem somente no aparelho de origem continuam dependendo desse aparelho.

## Indicadores e desempenho

**Fiscal → Indicadores** reutiliza `buildOperationalSummary_`, `buildConformityRecords_`, `buildFinancialRecords_`, `topThreeMarkup`, `barsMarkup`, `supervisor-conformity.js` e `supervisor-financial.js`.

- TOP 3 mensal pela data original em America/Bahia; UUID distinto; aguardando conferência e publicadas elegíveis.
- Ocorrências por Base: mês atual ou histórico completo.
- Conformidade por Base/chefe: aprovação sem edição direta do Supervisor versus edição efetiva; reprovadas/solicitações opcionais. Correção Fiscal nunca vira edição direta do Supervisor.
- Financeiro: Valor atual ou Enviado × Corrigido, com período, Base, chefe e equipe. Enviado usa o valor anterior à primeira intervenção financeira comprovada; final usa o publicado. Sem intervenção, os valores são iguais. Dados ausentes/ambíguos permanecem não comprovados.

O servidor filtra linhas e histórico pelas Bases autorizadas antes da projeção. Uma chamada agrega os indicadores, em paralelo com a lista; filtros não fazem novas consultas. Cache em memória depende da sessão/revisão/Bases e é limpo no logout. Respostas atrasadas são descartadas. Intervenções financeiras fiscais têm auditoria própria.

## Validação

Fixtures locais e backend em memória; nenhum login operacional ou escrita em ocorrências reais.

| Suíte | Resultado |
|---|---:|
| Correções fiscais, matriz de 18 cenários, legado e indicadores | 33/33 |
| Persistência, releitura e retry de correções | 53/53 |
| Serviços históricos nas correções | 48/48 |
| Funcionalidades operacionais e ACL | 36/36 |
| Administração Fiscal | 17/17 |
| Auditoria geral e IndexedDB | 80/80 |
| Validação por etapa (comportamento) | 60/60 |
| Financeiro compartilhado | 27/27; 3 snapshots antigos opcionais não executados |
| Conformidade e Excel | 22/22 |
| Contratos e preços | 16/16 |
| Catálogo de materiais | 28/28 |
| Cartões e consulta Fiscal | 15/15 |
| PWA, versão e imports | Aprovado |

UI nova aprovada em 1440×1000 e 390×844: rascunho após reload, foto com preview local, resposta perdida, retry completo, proprietário original preservado, gestão do principal, filtros sem nova chamada e descarte após logout. Consulta/PDF/Excel foi validada em desktop, Android e iPhone emulados; UI operacional existente passou 24 verificações e a financeira não registrou erros. Não houve teste físico em Safari/iPhone.

As suítes históricas `create-photo-commit` e `identifier-readback` têm um caso que reproduz um defeito antigo e exige a fonte anterior 2026.10.07.1; o baseline atual já corrigido não reproduz esse defeito. Esses casos não integram a aprovação desta versão. As verificações atuais correspondentes estão cobertas por persistência, serviços históricos e fluxo Fiscal.

## Implantação

Repositório: `engenhsoft/ocorrencias-bq`, base `11e7ad517ebf358449534d138f429504ccdadfb4`. Backend aplicado primeiro no projeto e deployment existentes. `ProfileSupervisorReadOnly20261007.gs` foi preservado. Nenhuma configuração privada ou credencial foi alterada. O repositório contém módulos públicos e patch incremental sem credenciais; a fonte completa continua no Apps Script.

Frontend e Service Worker: `2026.10.15.3`, cache `ocorrencias-bq-2026.10.15.3`. A publicação usa avanço normal do Git, sem force push. Identificadores finais de commit, deployment e execução Pages ficam no relatório de entrega.

## Reprodução

Passe a fonte privada oficial como primeiro argumento de `tests/fiscal-corrections.mjs`, `tests/correction-persistence.mjs`, `tests/field-historical-correction.mjs`, `tests/operational-features.mjs` e `tests/fiscal-admin.mjs`. Para validar as quatro linhas reais sem escrita, defina `OCCBQ_LEGACY_SNAPSHOT` com o snapshot autorizado. Os testes de interface interceptam todas as requisições externas; `OCCBQ_CHROMIUM_EXECUTABLE` pode selecionar o Chromium local.
