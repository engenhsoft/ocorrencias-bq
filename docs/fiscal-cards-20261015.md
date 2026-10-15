# Fiscal: cartões completos e consulta progressiva — 15/10/2026

Frontend/backend `2026.10.15.2`, sobre a main oficial `c8f2e92`. Checkout inicial limpo; trabalho isolado em `hotfix/fiscal-cards-20261015`. As branches anteriores, inclusive o commit local antigo não publicado, foram preservadas. Nenhum commit recente da main foi removido.

## Apresentação e ações

O Fiscal usa as mesmas classes de cartão, conteúdo, metadados, status e miniaturas do Supervisor. `occurrence-card.js` extrai os dois pequenos blocos compartilhados de metadados e miniaturas; o teste compara o HTML completo gerado pelo Supervisor antes/depois e exige igualdade. Os estilos adicionais são limitados a `.fiscal-card`.

Cada cartão contém número, UUID, status, tipos, Sub-base, contrato, equipe, chefe, valor, data, responsável e contagem de fotos confirmadas. Cinco slots gerais e, para Trafo, duas evidências; ausências são identificadas. Miniaturas proporcionais de 320 px, com `loading=lazy` e `decoding=async`. Ampliação usa a rota autenticada de foto existente, com validação de UUID e slot.

O rodapé tem exclusivamente **VISUALIZAR | GERAR PDF | GERAR EXCEL**. Detalhe usa o renderizador de consulta existente e não oferece campos de alteração. PDF individual e Excel individual/múltiplo continuam nos módulos originais. Downloads reais do navegador simulado validaram quatro abas e 7 fotos no Excel individual / 12 no consolidado de duas ocorrências, em desktop e viewport iPhone. Os módulos PDF/Excel só tiveram referências de release atualizadas.

## Carregamento e isolamento

Uma chamada por página fiscal (60 registros), sem documento completo nem imagem original por cartão. Detalhe abre imediatamente com indicação de carga e busca dados sem aguardar fotos. Cache em memória por sessão, usuário, Bases, revisão, UUID e versão do registro: até 12 detalhes, 30 segundos; alterações de sessão limpam os dados, respostas antigas são descartadas e consultas concorrentes são deduplicadas. Atualização com dados iguais preserva os cartões no DOM. Abrir/reabrir detalhe não recarrega a lista.

As Bases são filtradas no servidor antes da projeção. Rotas existentes de documento, fotografia, PDF e Excel continuam validando sessão/UUID/Base; Fiscal comum e mestra continuam impedidos de modificar ocorrências. Nenhum preview local do Campo é usado.

## Extensão indispensável do Apps Script

A resposta antiga `fiscalRecordSummary_` não trazia contrato, confirmação nem referência de fotos. Buscar documentos completos por cartão violaria o objetivo de desempenho. O patch aditivo inclui esses campos a partir da linha já autorizada e compartilha a projeção de slots com o documento. Não faz I/O do Drive na listagem, não muda compartilhamento de arquivos, autenticação, cadastro, ACL, rotas ou regras de negócio.

Aplicado somente ao projeto oficial, no arquivo `ApprovalIntegrity20260911.gs`. **Deployment existente atualizado para versão 36**, com o mesmo executor, acesso e endpoint. Fonte oficial anterior conferido por SHA-256; candidato preparado idêntico ao fonte testado. Após salvar, reload do editor confirmou release `2026.10.15.2`; a interface confirmou implantação atualizada e health confirmou release/contrato v12. Arquivo auxiliar e propriedades preservados. O repositório contém apenas a projeção e o patch, sem o fonte privado completo. O patch sem contexto pode ser aplicado à versão base conferida com `git apply --unidiff-zero`.

## Comparação controlada

Chromium local, mesma máquina, mesmos mocks e dataset, três amostras por versão; 120 ms por chamada de API e 180 ms por miniatura. Zero login operacional e zero alteração de ocorrência real.

| Mediana (ms) | Antes | Depois |
| --- | ---: | ---: |
| Lista fiscal disponível | 215 | 293 |
| Modal visível | 1360 | 77 |
| Dados detalhados disponíveis | 1365 | 260 |
| Reabertura dos dados | 1349 | 134 |

Antes: uma chamada de documento e sete fotos sequenciais antes do detalhe. Depois: uma chamada de documento e nenhuma chamada de foto antes do detalhe; reabertura sem nova chamada de documento. A lista mais completa teve pequeno custo adicional de renderização nas amostras. Não se afirma ganho na listagem nem equivalência de tempos em produção. O Supervisor continua abrindo seu detalhe em memória; tempos de controle por viewport constam no JSON.

## Validação

**186 checagens/grupos contados aprovados, zero falhas finais**, mais dois grupos da UI de exportação existente e três grupos da nova UI (1440, 390 e 360 px). As três amostras de performance antes/depois constam de `verification/fiscal-cards-20261015.json`. PWA/cache, sintaxe e diff sem erros. Três snapshots financeiros históricos opcionais não foram executados; os 27 testes financeiros regulares passaram.

Cobertura: layout/status/metadados, gerais/Trafo, slots ausentes, consultas somente leitura, PDF, Excel individual/múltiplo, uma/várias Bases, negativas por Base/UUID e mutações, ausência de aprovação nos cartões, cache/deduplicação/stale response, mesma saída do Supervisor, rolagem horizontal e ações acima do menu inferior. Viewports iPhone/Android usam Chromium; Safari e aparelhos físicos não foram testados.

A suíte antiga de Excel UI passou a escolher explicitamente o filtro Todas nas ocorrências do Campo, para não depender do dia da execução. O harness de carga do Supervisor recebeu os dois helpers extraídos. Nenhum comportamento do Campo mudou.

## Reprodução

```sh
node tests/fiscal-cards.mjs BACKEND.gs BASELINE_APP.js
OCCBQ_CHROMIUM_EXECUTABLE=/caminho/chromium node tests/fiscal-cards-ui.mjs /caminho/baseline-repo
node tests/pwa-release.mjs
```

Os fontes completos usados nos testes permanecem privados. Não usar login operacional real para QA.
