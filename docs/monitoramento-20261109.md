# Monitoramento e compatibilidade

Release 2026.11.09.1. O backend usa o Apps Script oficial na versão de implantação 45, publicada em 9 de novembro de 2026 às 22h28 no horário da Bahia. O contrato continua em **OCORRENCIAS-BQ-CORRECTION-PERSISTENCE-v12**.

## Operação

- O Supervisor abre Saúde das Ocorrências, Correções Atrasadas, Usuários Online, Acessos dos Fiscais, Histórico e Auditoria e Log de Erros em **Monitoramento e auditoria**. As consultas são feitas sob demanda. Os detalhes usam o UUID da ocorrência.
- O diagnóstico usa linhas, recibos, histórico e logs conhecidos. A fila mostra os Blobs do aparelho em que o usuário está trabalhando. Até três tentativas automáticas são feitas por envio. A retentativa manual continua disponível para erros recuperáveis. Divergências comprovadas encaminham o usuário para a revisão.
- A presença usa cache com sinais a cada dois minutos na aba visível. A estimativa passa a inativa aos cinco minutos e a desconectada aos quinze. O cache mantém sinais recentes por até trinta minutos. O Campo informa uma identidade declarada.
- A visualização financeira usa a data original em `America/Bahia` e os valores confirmados já registrados.
- A comparação usa diferenças históricas preservadas e recibos completos. A foto é carregada sob demanda após a conferência de UUID, slot e uploadKey, quando existente. Uma versão anterior indisponível fica indicada no comparador.

## Contrato de atualização

O health oficial publica o contrato principal e `compatibility.schema = 1`. `acceptedContracts` contém os contratos aceitos por padrão. `operationContracts` pode especificar contratos por mutação. `localSchemas` enumera os esquemas locais aceitos. A ausência de contrato no cliente legado corresponde ao contrato v12. O frontend novo envia `clientContract`, `clientSchema` e `clientVersion`. O servidor devolve `CLIENT_UPDATE_REQUIRED` apenas para mutações com incompatibilidade comprovada.

`release-info.json` é publicado junto com os assets e informa a versão frontend. A comparação de versões indica disponibilidade de atualização. A compatibilidade de operações vem das listas de contratos e esquemas. O verificador confere a versão do Service Worker por mensagem e mostra as versões dos assets principais.

A instalação aguarda os envios ativos e a gravação do rascunho aberto. As abas atualizadas compartilham uma trava para coordenar sincronização e ativação. O Service Worker mantém o cache da versão anterior para abas abertas e valida a composição da versão nova antes de ativá-la. O esquema do IndexedDB permanece em 1.

## Armazenamento e reversão

`instalarMonitoramentoBQ` é executado no editor do projeto oficial. O instalador é idempotente e exige que o arquivo privado tenha acesso restrito ao proprietário. O identificador fica em `BQ_MONITOR_LEDGER_V1`, nas propriedades do Apps Script. A planilha operacional continua sendo a fonte dos dados e do histórico que já existia. A planilha privada guarda os acessos, erros e novas evidências técnicas. Os erros registram códigos, etapas e correlações sanitizadas. O cache limita a frequência de ocorrências equivalentes.

Em uma reversão de backend, selecione a versão 44 no deployment atual. Em uma reversão de frontend, publique a revisão de retorno com uma nova versão de assets e do Service Worker. Mantenha o arquivo privado, os recibos e os dados locais para conferência.
