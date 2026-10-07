# Hotfix do delta de correção — 07/10/2026

Patch validado e preparado para publicação. O Apps Script abriu sem sessão autenticada; a implantação não foi executada. Uma edição direta do Supervisor comprovada deve permanecer preservada, sem reabertura automática por um recibo anterior vazio. A branch mantém o frontend e o patch do mesmo backend prontos para revisão.

## Referência inicial

- Branch: `hotfix/correction-delta-20261007`.
- HEAD inicial: `1603921c304d496d1c5995544ed77a69eb3e810a`.
- Frontend inicial: `2026.10.07.1`; candidato: `2026.10.07.2`, build `2026-10-07-correction-delta`.
- Apps Script inicial: `2026.10.07.2`; candidato: `2026.10.07.3`. Contrato `OCORRENCIAS-BQ-CORRECTION-PERSISTENCE-v12` preservado.
- IndexedDB, stores, fila, planilha, UUID, aprovação e endpoint preservados.

## Diagnóstico comprovado e limite da evidência

O backend aceitava uma primeira submissão sem alteração. `prepareCorrectionReceipt_` gerava `expectedPatch: {}` e `beforePatch: {}` ao comparar dados iguais; `finishCorrection_` verificava a releitura/fingerprint e as fotos já existentes, sem exigir delta efetivo. Assim, dados antigos perfeitamente relidos recebiam `COMPLETE`, `CORRECAO_REENVIADA` e `AGUARDANDO_SUPERVISOR`. Esse falso sucesso foi reproduzido com o fonte inicial.

Os bindings normais de PG e observação capturaram ambos no harness com o aplicativo completo. Não foi encontrado diff entre duas referências mutadas, closure antiga ou lista de dirty fields desatualizada. O formulário não tinha baseline independente do estado original nem recalculava o delta no clique.

Uma vulnerabilidade adicional de ordenação foi reproduzida com armazenamento simulado: uma escrita antiga de rascunho liberada depois do enqueue sobrescreveu o registro local; o worker leu PG antigo/observação vazia, embora o DOM mantivesse a edição. Antes do patch, saves independentes não eram drenados pelo submit. Agora, os saves são ordenados e o candidato capturado no clique é gravado depois deles. Essa reprodução impõe atraso ao mock de armazenamento; não comprova que essa foi a ordem das transações IndexedDB no celular do caso histórico. Não há trace do DOM/payload nem acesso ao IndexedDB desse aparelho para atribuir com certeza a origem histórica do delta vazio.

## Mudanças

| Etapa | Proteção aplicada |
|---|---|
| DOM e state | Submit lê os controles atuais e captura uma cópia independente antes da confirmação. |
| Original | Snapshot separado, congelado e preservado no rascunho; recuperação por leitura do UUID quando necessário. |
| Delta | Comparação original × current, sem depender de dirty flags; dados, fotos gerais e evidências específicas. |
| IndexedDB | Writes de rascunho ordenados; o candidato final espera os writes anteriores. |
| Payload | `expectedPatch`, `beforePatch`, `photoPatch` e `evidencePatch` acompanham o envio aplicável. |
| Backend | Recalcula o delta operacional a partir da linha armazenada; valida o delta enviado pelo cliente atual. |
| Vazio | `NO_CORRECTION_CHANGES`, sem staging em primeira submissão vazia, sem evento final. |
| Post-write | Fingerprint completo e releitura da linha permanecem obrigatórios. |
| Fotos | UploadKey declarado precisa corresponder ao slot; intenção de upload não vale como confirmação final. |
| COMPLETE | Exige delta de dados real ou foto/evidência nova persistida e confirmada; todos os slots declarados verificados. |
| Badge/estado | Recibo vazio não produz CORRIGIDO nem habilita a correção para aprovação. |
| Edição posterior do Supervisor | Preserva a edição direta comprovada por delta, timeline, timestamp e fingerprint atuais; não valida retroativamente um reenvio vazio da equipe. |

Mensagem de no-change: “Nenhuma alteração foi detectada. Faça a correção solicitada antes de reenviar.”

CREATE mantém confirmação de dados separada de PHOTO COMMIT e aceita `FOTOS_SENDO_SINCRONIZADAS`. CORRECTION COMMIT mantém a proteção anterior de gravar → reler → comparar, acrescida da exigência de delta real.

## Retry e retomada

Mesmo requestId/fingerprint retorna o recibo legítimo já aplicado, antes de comparar novamente contra os dados atualizados. Esse caso não é no-change real. Um recibo antigo COMPLETE vazio, sem foto/evidência nova comprovada, não recebe sucesso idempotente.

A migração preserva requestId de assinaturas legadas, inclusive quantidades com vírgula. Na resposta de foto perdida, o slot confirmado é reconciliado; só os faltantes são enviados. O arquivo e o evento de reenvio não duplicam. Rascunho, fila, UUID e blobs sobrevivem ao reload e ao offline; a reentrada em CORRIGIR conserva a substituição local pendente da mesma solicitação. Blob confirmado só é excluído pelo fluxo existente depois da confirmação segura.

## Recuperação guardada e edição direta do Supervisor

A recuperação continua no mesmo UUID e preserva os dados, o pedido original, o histórico, os serviços, os materiais e as fotos. Classificação A preserva o estado atual; B exige um payload persistido confiável e não vazio; C reabre o pedido original somente quando não há valores recuperáveis. Toda mutação B/C exige lease de status, pedido, último reenvio e fingerprint da linha. Nenhuma hipótese pode ser transformada em um valor de campo.

Uma edição direta do Supervisor é distinta do reenvio da equipe. Para preservar essa edição posterior, a auditoria precisa conter delta efetivo, timestamp válido posterior ao recibo, evento correspondente e fingerprint coincidente com os dados persistidos. Um marcador isolado não basta. Retry antigo não pode sobrescrever nem reabrir o estado confirmado; recuperação B/C também o preserva. O badge de reenvio vazio da equipe continua bloqueado. A edição direta do Supervisor e seu badge próprio permanecem no fluxo atual.

## Prova end-to-end

O teste carrega o HTML real, registra os handlers de `bindEvents`, edita input PG e textarea observação, clica no botão e captura o payload da API real antes da função de backend. O backend real executa em VM com Sheets/Drive simulados. Fixtures operacionais permanecem fora do repositório; nenhuma ocorrência real foi criada ou reenviada.

```json
{
  "beforePatch": { "pgPostInstalled": "PG_ORIGINAL", "observation": "" },
  "expectedPatch": {
    "pgPostInstalled": "NOVO_PG",
    "observation": "POSTE ALTERADO PARA FECHAMENTO"
  },
  "phase": "COMPLETE"
}
```

`NOVO_PG` e esse texto são valores de teste pedidos no roteiro; não foram aplicados ao registro real.

51 cenários focados aprovados: PG retirado/instalado, observação, ambos, clear explícito, seis campos de trafo individuais/combinados, PG condutor, no-change em cliente/backend, metadata sem mudança, fingerprint/recibo inválido, foto-only, evidência-only, slots parciais, resposta perdida, requestId legado, histórico preservado, serviço novo, material com zero inicial, QTD 15,50 no handler DOM, material 2,50 no handler DOM, offline, reload, reentrada e recuperação A/B/C nas suítes pertinentes. Cinco cenários adicionais validam a correção direta já persistida do Supervisor, retry antigo, recuperação indevida, marcador sem prova suficiente e nova edição legítima do Supervisor.

Total executado: 25 suítes, 753 casos e quatro grupos adicionais, todos aprovados. Regressões incluem login/primeira carga, Supervisor, serviços históricos, publicação/reconciliação, fotos, materiais, decimal, estabilidade, CREATE e PWA. Os benchmarks de login/carga usam `--current-baseline` para comparar ao estado inicial já otimizado; o modo histórico antigo continua disponível. `profile-stability` é uma medição mockada, não latência no celular nem no Apps Script real.

Comando focado, com fontes privados fora do repositório:

```bash
node tests/correction-delta.mjs BACKEND_CANDIDATO.gs BACKEND_INICIAL.gs FIXTURE_HISTORICA.json FRONTEND_INICIAL FIXTURE_ATUAL_READ_ONLY.json
```

O frontend inicial pode ser extraído do HEAD acima. Os resultados sanitizados estão em `verification/correction-delta-20261007.json`.

## Publicação pendente

Aplicar `patches/backend-correction-delta-20261007.patch` ao mesmo `ApprovalIntegrity20260911.gs`, conferir o fonte ativo antes do write, salvar e atualizar a implantação existente para a versão candidata. Manter endpoint, acesso e projeto. Depois atualizar main/Pages com este commit e verificar os assets/release/cache servidos. Reavaliar qualquer recuperação pelo estado atual do UUID antes de executar, preservando a classificação A. Nenhum write de QA foi feito em produção.

O editor redirecionou para a página pública do Apps Script com “Fazer login”. Na retomada, o O acesso Google requer reautenticação. A revisão automática rejeitou a seleção segura da conta porque iniciar login pode pedir credenciais, em conflito com a instrução explícita do usuário. Nenhum prompt de credenciais foi apresentado, nenhum backend/endpoint alternativo foi criado e não houve publicação parcial. A reautenticação requer autorização atual do usuário; o frontend candidato e o backend candidato ainda não são a release em produção.
