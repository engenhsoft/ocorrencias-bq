# Persistência de correções — 2026.10.06.3

A equipe podia editar uma ocorrência e reenviá-la ao Supervisor, mas o preflight de fotos substituía os dados locais pelos antigos. Campos de PG e Trafo fora do tipo correspondente também eram apagados. O backend confirmava a linha proposta sem reler a linha gravada.

O fluxo conserva a edição durante consultas, retomadas e sincronização. Nos registros em correção, os campos opcionais de PG e Trafo ficam disponíveis; sua obrigatoriedade, as fotos específicas de Trafo e a integração operacional continuam condicionadas ao tipo correspondente. Os dados opcionais salvos também aparecem no detalhe do Supervisor e permanecem em uma edição posterior.

O backend recebe um identificador estável de envio e a data da solicitação, registra a intenção na auditoria existente, grava mantendo a correção pendente e relê a linha pelo UUID. Confere os dados, os serviços e materiais estruturados, as referências de fotos e as colunas preservadas. Só então conclui o recibo, libera a ocorrência e registra `CORRECAO_REENVIADA`. A resposta vem da linha relida. Cliente e API também comparam os dados confirmados. Falhas preservam a edição; repetição do mesmo envio confirma o resultado existente sem duplicar o histórico.

Fotos usam intenção pequena por slot, com URL e chave esperadas. Uma gravação parcial não confirma a imagem nem descarta a referência anterior. A repetição reutiliza o arquivo do mesmo upload. O total histórico é enviado como salvo, incluindo arredondamentos existentes.

Atualizações conservam campos ausentes ou `undefined`; valores vazios explícitos limpam campos opcionais. `null` limpa texto opcional e continua inválido para campos obrigatórios. A validação histórica de serviços, os preços H/I para novas seleções, os materiais com zeros iniciais e as regras de séries permanecem ativos. Cliente anterior sem metadados da solicitação recebe orientação para atualizar antes de reenviar uma correção real.

`recoverCorrectionCases_` é uma função administrativa dentro do mesmo projeto, sem rota pública. Recebe apenas UUIDs previamente classificados e confere cabeçalhos, unicidade, estado, data do pedido, último reenvio e fingerprint integral, sob o bloqueio existente. A preserva o caso. B exige um payload persistido que reconstrua o fingerprint e restaura apenas os campos correspondentes. C reabre a solicitação original. A recuperação é relida, não cria ocorrência nem reenvio fictício e não altera o histórico anterior. O plano operacional e os dados privados ficam fora deste repositório.

O delta privado é `patches/backend-correction-persistence-20261006.patch`, aplicado sobre o backend `2026.10.06.2` em `ApprovalIntegrity20260911.gs`. A implantação oficial existente e o endpoint são preservados. Frontend, imports, HTML e cache usam `2026.10.06.3`; o contrato do backend é `OCORRENCIAS-BQ-CORRECTION-PERSISTENCE-v12`.

Validação: 54 casos de persistência/recuperação com fixture privada, 49 de serviços históricos, 40 de snapshots/aprovação, 16 de contratos, 17 de decimais, 9 de fila e 68 de publicação/reconciliação. Versão/cache, navegação e aviso de fotos também passaram. Testes usam memória e mocks; nenhuma autenticação, submissão ou aprovação de QA ocorreu no aplicativo real.

```bash
node tests/correction-persistence.mjs /fonte/privado/backend.gs /fixture/privada/caso.json
node tests/field-historical-correction.mjs /fonte/privado/backend.gs /fixture/privada/historico.json
node tests/service-snapshot-approval.mjs /fonte/privado/backend.gs
node tests/publication-reconciliation.mjs /fonte/privado/backend.gs /fixture/privada/publicacao.json /fonte/privado/anterior.gs
node tests/contract-pricing.mjs
node tests/login-supervisor-decimal.mjs
node tests/operational-stability.mjs
node tests/pwa-release.mjs
```

Sem a fixture privada, a suíte de persistência contém 53 casos sintéticos. O quarto argumento permite usar fontes anteriores para reproduzir as falhas. O fonte integral do backend e as fixtures operacionais não são publicados.
