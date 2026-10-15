# Hotfix operacional — 2026.10.15.4

Base preservada: `908b25df0ba7cdacd9086bbb95eac961a3924eb0`, `main`. Mesmo aplicativo, planilha, projeto Apps Script e endpoint. Nenhum registro operacional foi criado, reenviado ou aprovado para QA.

## Diagnóstico e correção

- **Campo:** uma resposta perdida interrompia a sequência mesmo quando os dados/fotos já estavam gravados. O retry das correções repetia o submit por não reconhecer o recibo confirmado. A conciliação também podia herdar uma confirmação local de slot ausente numa resposta autoritativa. Agora a releitura por UUID reconhece dados e uploadKey, retoma os slots pendentes e exige evidência confirmada no servidor. CREATE idêntico não regrava dados/histórico; atualização apenas da declaração de slots não duplica o evento de criação. Uma divergência real de dados mantém a intenção local e retorna conflito recuperável.
- **Supervisor:** havia uma recarga integral de `listPending` após cada decisão e uma leitura completa adicional dos cinco conjuntos da publicação sob lock. Respostas perdidas viravam erro sem consultar o resultado. A API agora exige linha principal, serviços, materiais, histórico, auditoria final e remoção da cópia pendente comprovados. Uma única releitura recupera resposta perdida/timeout; se a publicação terminar durante essa consulta, ela relê a linha oficial para responder com o status final; publicação parcial continua exigindo retry da reconciliação existente. O painel e os KPIs recebem o UUID confirmado, sem nova carga integral. Uma resposta de carga anterior não pode sobrescrever uma decisão mais recente. Locks, validações e multiconjuntos dos itens permanecem.
- **Fiscal:** quando a última confirmação falhava após a gravação, o servidor retirava a solicitação da lista e a interface ocultava a única ação de retomada. Rascunhos pendentes agora continuam visíveis e oferecem **SINCRONIZAR AGORA**, inclusive quando o Supervisor já publicou. Essa leitura de conclusão não concede permissão de editar registros fechados. Outra falha reproduzida era editar novamente após DATA_VERIFIED com foto pendente: o delta contra o snapshot inicial não correspondia à linha já atualizada. Uma substituição explícita do recibo anterior, validada por identidade, ator, pedido e fingerprint, mantém o snapshot anterior arquivado e rejeita abas obsoletas.
- **Estado visível:** salvo no aparelho, enviando, sincronizando fotos com contagens, aguardando confirmação, erro com retry e correção reenviada. São metadados locais, sem novos status na planilha. Rascunhos usam usuário, revisão do cadastro, UUID, pedido e atribuição; atualizações de UI dependem da sessão ativa. A migração de um rascunho anterior só ocorre após autorização do mesmo pedido no servidor. Logout descarta respostas atrasadas.

## Validação

19 suítes selecionadas passaram, incluindo persistência (53), serviços históricos (48), publicação/reconciliação e concorrência (59), Fiscal (32), administração Fiscal (17), ACL e funcionalidades (36), auditoria/IndexedDB (80), validação comportamental por etapa (60), financeiro, PDF, Excel, catálogo, navegação e PWA. A suíte nova contém 16 cenários adicionais de integração, com dados persistidos em Sheets/Drive em memória. CREATE passou nos 23 casos atuais; o caso que exige exclusivamente a fonte histórica 2026.10.07.1 foi indicado como não executado. Dez verificações antigas de isolamento de outro patch foram excluídas com a opção existente `--behavior-only`.

A interface passou em 1440×1000 e 390×844, com perfil móvel iPhone/Safari em **Chromium**, sem erros de página. Abrange recarga de rascunho, foto local, perda de resposta após persistência, erro na confirmação final, retry, contador Fiscal, troca de conta, clique duplo, aprovação, navegação e KPIs sem recarregar a lista. Safari/WebKit físico e adoção do cache nos aparelhos reais continuam sem verificação física.

As quatro solicitações antigas foram identificadas por consulta somente leitura e continuam no fluxo LEGACY_FIELD. Os testes verificam as quatro rotas sem migrar responsável. Este hotfix não executa recuperação ou atualização dessas linhas.

## Medição controlada

30 amostras por versão, Node VM e armazenamento em RAM, sem latência do Google:

| Aprovação | Antes | Depois |
|---|---:|---:|
| Leituras | 22 | 17 |
| Buscas por UUID | 20 | 15 |
| Gravações | 6 | 6 |
| Mediana | 2,94 ms | 2,34 ms |
| p95 | 5,08 ms | 3,63 ms |

Os tempos não representam SLA de produção. A resposta de aprovação inclui tempos de preparação, espera de lock, inspeção, artefatos, integração, commit e confirmação para medir o tráfego real sem aprovar registros para QA.

## Implantação

Backend aplicado e relido byte a byte após recarga do editor: `ApprovalIntegrity20260911.gs`, release `2026.10.15.4`, contrato v12, **versão 40**. Deployment preservado: `AKfycbyq_gRMEPzN7xImFqrx-g2mrZt1PCcC4_8RFOinhqONsnpyj6_OmauIPeXe7NGrA31f`. A versão 39 confirmou health às 16:27:01, Bahia; a versão 40 acrescenta a conciliação da resposta durante publicação concorrente. Arquivo auxiliar, manifesto, propriedades, executor e acesso preservados.

Frontend, imports e Service Worker usam `2026.10.15.4`. Os principais arquivos funcionais são `app.js`, `api.js`, `core.js`, `db.js`, `fiscal-drafts.js`, `fiscal-workspace.js` e `operational-features.js`. Os demais módulos receberam atualização dos imports de cache. O patch incremental público não contém a configuração privada. Evidências automatizadas e hashes estão em `verification/hotfix-sync-publication-20261015.json`. Commit e confirmação final do Pages são registrados na entrega.
