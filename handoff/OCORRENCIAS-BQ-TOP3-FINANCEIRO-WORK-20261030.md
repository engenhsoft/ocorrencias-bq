# TOP 3 por valor dos serviços — concluir no Work

Escopo autorizado: somente mudar a classificação e apresentação do TOP 3 mensal de chefes de turma. O frontend candidato é `2026.10.30.1`; o backend observado em 30/10/2026 continua `2026.10.23.3`, contrato v12. A implantação do Apps Script não foi feita: o navegador mostra a conta Google desconectada, não há clasp configurado e o conector Drive permite exportar, mas não publicar deployments. Não solicitar senhas no chat.

## Alvos existentes

- Repositório: https://github.com/engenhsoft/ocorrencias-bq .
- Frontend: https://engenhsoft.github.io/ocorrencias-bq/ .
- Projeto oficial: https://script.google.com/d/1S65w-vU8SNGI3XsrWjZl609yEu4uQRhRrnQrlnI1bSWg1Gyy_xvup94z/edit .
- Deployment a preservar: `AKfycbyq_gRMEPzN7xImFqrx-g2mrZt1PCcC4_8RFOinhqONsnpyj6_OmauIPeXe7NGrA31f`.
- Endpoint: https://script.google.com/macros/s/AKfycbyq_gRMEPzN7xImFqrx-g2mrZt1PCcC4_8RFOinhqONsnpyj6_OmauIPeXe7NGrA31f/exec .
- Arquivo oficial: `ApprovalIntegrity20260911.gs`. A função do módulo público `backend/OperationalFeatures20261014.gs` já está incorporada nesse arquivo. Não instalar o módulo inteiro nem duplicar funções.

## Patch preparado e verificado

`patches/backend-top3-financial-20261030.patch` contém somente a validação do total e o comparador do TOP 3 em `buildOperationalSummary_`, além do identificador `APP.version`.

A ordem é total válido decrescente, quantidade decrescente e nome normalizado crescente. Total ausente, vazio, não numérico, infinito, negativo ou de tipo impróprio torna o valor do chefe indisponível, seguindo o comportamento anterior para totais inválidos; fica abaixo de qualquer valor válido, inclusive zero. A quantidade continua contando UUIDs elegíveis. A soma e o arredondamento financeiro existentes foram preservados.

O fonte completo oficial foi exportado em modo somente leitura e mantido fora do repositório público. SHA-256 anterior: `308c889b166e57cb5d4afede1ed122b72cfb6acf3853a9f68c8d390f884a7c1a`. SHA-256 candidato: `ce372e139fc92c121b2c62677db62402c7ca788db4974786a8e9561e6a2e592b`.

## Execução no Work

1. Conectar a conta proprietária ao Google por interface segura e abrir o projeto oficial. Registrar número da versão atualmente implantada e opções de acesso. Exportar uma cópia privada atual antes de editar.
2. Comparar o SHA-256 atual com o anterior acima. Se divergir, comparar a função atual e portar apenas este delta, preservando alterações posteriores e CHAVES. Não substituir o projeto pelo módulo público ou por um fonte histórico.
3. No diretório privado com `ApprovalIntegrity20260911.gs`, executar `git apply --check /caminho/do/repositorio/patches/backend-top3-financial-20261030.patch` e depois aplicar o patch. Se já houver release posterior, manter um identificador novo e adequado em vez de regredir a versão.
4. Validar o fonte candidato completo: `node tests/operational-features.mjs /privado/ApprovalIntegrity20260911.candidate.gs`. Os 43 testes devem passar, incluindo valor antes de quantidade e corte TOP 3, empates, totais inválidos, centavos/UUID, Bases do Fiscal e virada mensal Bahia. Revalidar PWA com `node tests/pwa-release.mjs` e integridade com `node tests/static-audit.mjs` caso o frontend também seja alterado.
5. Salvar somente o delta no arquivo oficial existente. Nenhum instalador, migration, bootstrap ou gravação em planilhas é necessário. Preservar manifesto, propriedades, credenciais, arquivo auxiliar, fórmulas, cabeçalhos e registros.
6. Criar uma nova versão e editar o MESMO deployment existente para essa versão, mantendo executor e acesso. Não criar endpoint paralelo.
7. Consultar `/exec?action=health` em modo somente leitura. Confirmar versão candidata e contrato `OCORRENCIAS-BQ-CORRECTION-PERSISTENCE-v12`; registrar o número real da versão Apps Script, deployment preservado e SHA-256 final. Não confundir o rótulo `APP.version` com o número de versão do Apps Script.
8. Conferir o TOP 3 em Campo, Supervisor e Fiscal com acesso legítimo, sem ocorrências de QA produtivas. No Fiscal, confirmar que a ordenação usa somente suas Bases autorizadas. Registrar o commit e o run Pages da release frontend.

## Estado e limites

O frontend mostra reais em destaque, quantidade em tamanho secundário e a descrição solicitada, mantendo cartões e CSS. Suas referências de versão e cache foram atualizadas em conjunto porque o PWA rejeita assets de releases diferentes. Enquanto o backend oficial não receber este patch, ele continuará devolvendo o TOP 3 por quantidade; publicar somente o frontend não ativa a classificação financeira. Não tentar corrigir isso reordenando apenas os três líderes recebidos, pois um quarto chefe com maior valor continuaria excluído.

Evidências locais: `verification/top3-financial-20261030.json`. Os testes novos reproduziram três falhas no fonte anterior e passaram no candidato. As regressões do frontend, PWA e auditoria estática passaram. O harness visual Chromium não executou porque o binário está indisponível e o download retornou arquivo incompleto; os testes de markup verificaram destaque financeiro, quantidade secundária, texto, zero válido, indisponíveis e escape HTML.

Rollback backend: selecionar a versão anterior no mesmo deployment; não tocar em dados. Rollback frontend: nova release de cache com o código anterior, preservando IndexedDB e fotografias locais. Relatar separadamente o que foi publicado e o que continua pendente.
