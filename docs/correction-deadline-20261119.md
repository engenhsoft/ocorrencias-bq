# Prazo de correção e pendências por Fiscal — frontend/backend 2026.11.19.3

Base verificada: frontend/backend 2026.11.09.2, contrato v12, Apps Script 46, main `5108009538bea0a66301fc341a284beaadce894d`. Não havia PR aberto. O endpoint e a planilha operacional foram conferidos em uso.

A solicitação formal existente recebe prazo de 72 horas corridas a partir de `requestedAt` do servidor, com aviso nas últimas 24 horas. Ao atingir o limite, a projeção operacional passa para REPROVADA, motivo FORA DO PRAZO DE CORREÇÃO, e sai das listas e do gráfico de pendências. A rotina agendada de cinco minutos persiste a reprovação e seu histórico, inclusive com o aplicativo fechado; as consultas e cada tentativa de escrita aplicam o limite diretamente, sem aguardar o gatilho. O registro e as fotografias permanecem disponíveis para consulta e novo lançamento relacionado. O estado de prazo pertence à rodada em `audit.lastCorrectionRequest`; não cria uma segunda fila operacional. Recebimentos de dados, fotografias e conclusão validam o prazo no backend. Um envio offline tardio não usa o relógio local para obter validade. Repetir pedido aberto mantém a rodada e o prazo. Uma nova rodada legítima conserva os dados da anterior. Solicitações sem data comprovada não recebem data presumida; correções anteriores concluídas não são reclassificadas.

A conclusão exige recibos verificados dos campos e evidências. Respostas perdidas podem reconciliar provas já válidas; novos bytes não usam o recibo de outro slot para obter autorização. O novo lançamento usa o formulário operacional existente, novo UUID/número, validação completa e vínculo bidirecional com a ocorrência anterior. Não copia fotos nem aprova automaticamente.

O Supervisor ganha barras horizontais por responsável, total de pendências abertas e detalhes por ocorrência, sem os KPIs dentro do prazo, fora do prazo e tempo médio de espera. O gráfico e os cartões usam `supervisorPendingRecords`, deduplicados por UUID. Datas são exibidas em America/Fortaleza. Sem data comprovada há categoria cinza explícita, sem reprovação presumida. O relógio da interface é calibrado pelas respostas do servidor; a regra de autorização continua no servidor.

A limpeza é administrativa, pelo editor oficial, sem rota HTTP de exclusão. A lista fechada foi confrontada com a aba Pendências (11), distinta do indicador geral (18). A preparação guarda registros, histórico e cópias das fotos exclusivas em pasta privada fora das consultas. A execução revalida a seleção/fingerprint, grava bloqueios duráveis por UUID antes de excluir e suporta retomada idempotente. Preserva referências compartilhadas e a ocorrência protegida. O frontend aplica os UUIDs removidos ao IndexedDB, rascunhos fiscais e filas; o backend recusa recriação por clientes antigos.

A cópia técnica da seleção contém dez registros principais, 18 linhas de histórico e 36 fotografias exclusivas; não há linhas desses UUIDs na base publicada, serviços ou materiais. Identificadores operacionais e cópias privadas não integram o repositório público. A execução e a conferência final ficam no relatório administrativo do proprietário.

## Validação

20 suítes executadas com sucesso, incluindo as verificações do workflow Pages e testes da fonte completa atual do Apps Script. São 23 cenários de backend e 11 de interface/dados: limites 24/48/72 h, exatamente no vencimento, fim de semana, tentativa offline, idempotência, recibos perdidos, novas rodadas, novo lançamento, totais, ordenação, duplicatas, exclusão física, cache antigo e proteção das fotos/registro preservado.

As fixtures legadas que verificam reenvio dentro de uma janela válida passam a usar uma solicitação de uma hora atrás; o novo teste de prazo cobre a recusa após 72 h. Mocks recebem os novos colaboradores. Asserções de integridade, autorização, concorrência e performance não foram removidas. O teste de fila continua exigindo duas transações.

## Implantação e reversão

Aplicar o patch incremental à fonte oficial correspondente e acrescentar `backend/CorrectionDeadline20261119.gs`; a manutenção usa `maintenance/targeted-removal-20261119.gs` com a lista privada validada. Não publicar a fonte integral privada ou propriedades. Atualizar o deployment existente, mantendo URL, permissões, contrato v12 e IndexedDB 1. Publicar frontend com todos os assets e Service Worker na mesma versão, sem limpar o banco local.

Depois da limpeza, uma reversão de frontend não pode remover o bloqueio de UUIDs do backend. Não selecionar uma versão antiga do Apps Script que permita recriação: preparar uma versão de retorno que conserve a política de remoção. O backup de recuperação é privado, tem retenção administrativa de 30 dias registrada e nunca é consultado para restaurar automaticamente a seleção removida.

A homologação publicada também verifica a abertura pelo gráfico a partir de outra aba ou com filtros incompatíveis. O acesso direciona para Correções e usa a conferência existente.

## Ajuste de reprovação automática — 2026.11.19.3

A versão anterior bloqueava a correção vencida e a mantinha pendente. O novo comportamento reprova por prazo sem apagar a ocorrência. O instalador `instalarPrazosCorrecaoBQ` cria um único gatilho `atualizarPrazosCorrecaoBQ` de cinco minutos; não remove outros agendamentos. A persistência é idempotente e confirma o evento de histórico uma única vez. Recebimentos integralmente comprovados antes do vencimento reconciliam sua confirmação; não recebem reprovação por atraso na resposta ou na finalização. Novos bytes tardios continuam bloqueados. Os indicadores gerais e a listagem também deixam de contar vencidas enquanto a tela permanece aberta.
