# TOP 3 por valor dos serviços — publicação concluída

Concluído em 30/10/2026. O TOP 3 mensal agora usa valor total dos serviços em ordem decrescente; quantidade decrescente e nome normalizado crescente resolvem empates. O valor em reais aparece em destaque, com quantidade em tamanho secundário.

## Versões e publicação

- Código do hotfix: `af3a78a4d0fc088eaa52cff14efa83e44c762a28`.
- Frontend: `2026.10.30.1`, publicado no [GitHub Pages](https://engenhsoft.github.io/ocorrencias-bq/).
- [Workflow do código frontend: SUCCESS](https://github.com/engenhsoft/ocorrencias-bq/actions/runs/41028350212).
- Apps Script oficial: **versão 43**, publicada em 30/10/2026 às 05:58, fuso Bahia. Versão anterior: 42.
- Rótulo backend: `2026.10.30.1`; contrato mantido em `OCORRENCIAS-BQ-CORRECTION-PERSISTENCE-v12`.
- Mesmo deployment: `AKfycbyq_gRMEPzN7xImFqrx-g2mrZt1PCcC4_8RFOinhqONsnpyj6_OmauIPeXe7NGrA31f`.
- Mesmo [endpoint oficial](https://script.google.com/macros/s/AKfycbyq_gRMEPzN7xImFqrx-g2mrZt1PCcC4_8RFOinhqONsnpyj6_OmauIPeXe7NGrA31f/exec).

O acesso ao Google foi restabelecido pela autenticação segura. Foi editada a implantação existente; executor e acesso permaneceram iguais. O health público confirmou a nova versão em 30/10/2026 às 05:59:51, horário Bahia.

## Alterações e validação

Mudanças funcionais restritas a `buildOperationalSummary_` em `backend/OperationalFeatures20261014.gs` e `topThreeMarkup` em `operational-features.js`. No projeto oficial, o delta foi aplicado ao arquivo existente `ApprovalIntegrity20260911.gs`, sem adicionar funções duplicadas. As demais mudanças de código são referências de versão coerentes com o cache do PWA.

Totais ausentes ou inválidos ficam indisponíveis e abaixo de qualquer total válido, inclusive zero. Permaneceram intactos soma/arredondamento financeiro, mês/data original/Bahia, identidade dos chefes, elegibilidade, UUID, escopo de Bases do Fiscal e demais fluxos. Nenhuma gravação em registros operacionais ou alteração de cabeçalhos foi feita pelo hotfix.

Os **43 testes operacionais** passaram novamente sobre o fonte realmente salvo no Google. Eles cobrem valor antes da quantidade e corte TOP 3, desempates, totais inválidos, centavos/UUID, Bases do Fiscal, papéis e atualização mensal. Também passaram 51 verificações estáticas, a release PWA e todas as regressões obrigatórias do Pages. Os testes novos reproduziram três falhas no fonte anterior.

O fonte salvo foi reexportado e corresponde byte a byte ao candidato testado. Manifesto e fonte auxiliar foram comparados com a cópia anterior e permaneceram iguais.

- SHA-256 anterior: `308c889b166e57cb5d4afede1ed122b72cfb6acf3853a9f68c8d390f884a7c1a`.
- SHA-256 salvo/publicado: `ce372e139fc92c121b2c62677db62402c7ca788db4974786a8e9561e6a2e592b`.
- Patch reproduzível: `patches/backend-top3-financial-20261030.patch`.
- Evidências: `verification/top3-financial-20261030.json`.

O fonte integral privado e as cópias de segurança ficaram fora do repositório público. A conferência visual com sessões reais de Campo, Supervisor e Fiscal não foi executada; os papéis e a restrição por Base foram validados nos testes isolados do fonte oficial. O harness visual local Chromium ficou indisponível; a confirmação da implantação foi observada no navegador autenticado do Google.

## Reversão

Se necessária, selecionar a versão 42 no mesmo deployment. Reversão frontend exige uma nova versão de cache, preservando IndexedDB e fotografias locais. Não executar migrations, instaladores, bootstrap ou recuperação histórica para este hotfix.
