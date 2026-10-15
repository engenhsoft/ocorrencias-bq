# Foto Fiscal pendente — diagnóstico e retomada — 2026.10.15.5

Esta release publica diagnóstico por etapa e verificações locais adicionais. A
exceção do incidente de produção ainda não foi capturada; a resolução do
incidente depende de observar a retentativa no aparelho que conserva o Blob e
da confirmação do novo upload no servidor. A fonte oficial foi obtida e
testada em memória. Backend e contrato HTTP continuam os existentes (v12).

## Comportamento

`performSyncSingleRecord` conserva o recibo confirmado e identifica leitura do
rascunho, preparação do Blob, envio da foto e releitura. `syncProgress` informa
a foto em andamento e se os dados já estão confirmados. `lastSyncError` guarda
somente etapa, código, tipo conhecido de exceção, índice da foto e confirmação
dos dados. O console não recebe o objeto original do erro, corpo HTTP, token ou
imagem por estes caminhos.

O Fiscal vê uma mensagem recuperável com referência de suporte. Falhas de
autorização conservam sua mensagem própria. Leitura local inválida ou interrompida
recebe código específico. Antes do upload Fiscal, UUID, slot e uploadKey locais
devem corresponder ao rascunho; mudança de sessão durante a conversão interrompe
o envio. Uma resposta sem a nova chave confirmada preserva a substituição
pendente. A conclusão continua exigindo recibo COMPLETE e releitura final.

Nenhum identificador de banco, versão do IndexedDB, chave de rascunho ou contrato
de autorização foi alterado. O frontend usa o endpoint existente. A fonte do
Apps Script não foi modificada nesta release.

## Testes

`node tests/fiscal-photo-resume.mjs` executa 22 cenários com o código real do
frontend/API/adaptadores locais, IndexedDB em memória e contrato de servidor/Drive
sintético. Abrange foto isolada com DATA_VERIFIED, correção mista, slots 6/7,
legado Campo, falha antes/durante/depois do upload, resposta perdida, retentativa,
autorização recusada, atribuição alterada, sessão alterada e preservação do Blob.
Os testes que simulam autorização não validam a implementação privada do
backend. Não há escrita, login operacional ou aprovação de ocorrência real.

As oito suítes obrigatórias do workflow Pages passam antes da publicação:
retomada Fiscal (22), auditoria geral/IndexedDB (80), validação de etapas (60),
estabilidade operacional (9), preços (16), materiais (28), auditoria estática
(51) e coerência da release PWA. Total: 266 casos numéricos mais a verificação
PWA. Dez comparações históricas opcionais de validação de etapas são ignoradas
no modo `--behavior-only`.

Na comparação dirigida ao frontend anterior bdc8653, 9 dos 22 cenários novos já
passam e 13 identificam a ausência do novo diagnóstico/proteções. Isso não mede
a causa de produção. A suíte histórica `stability-audit.mjs` mantém os mesmos
55/58 e as mesmas três falhas do baseline; não integra a aprovação desta release.
As suítes contra a fonte principal oficial também passaram em memória:
Fiscal (32), persistência (53), correção histórica do Campo (48) e sincronização/
publicação (16), totalizando 149 casos. Uma reprodução offline da linha lida
do incidente confirmou o fingerprint do recibo, completou o upload simulado e
repetiu a mesma chave sem duplicar arquivo ou histórico. Esses testes usam
Drive simulado e não reproduzem o Blob do aparelho nem permissões reais do Drive.

## Publicação e continuação

Frontend/SW: `2026.10.15.5`, build `2026-10-15-fiscal-photo-diagnostics`.
O workflow Pages executa as regressões antes do deploy. A comprovação da
implantação e a situação do UUID real são registradas no relatório privado de
entrega. O workflow 38822229959 publicou a release após todas as regressões.
Seis assets servidos tiveram hashes conferidos e a atualização normal da PWA
exibiu .5. As execuções oficiais do horário aparecem como concluídas; `doPost`
captura erros e não registra a exceção em `errorJson_`, e os registros do Cloud
estavam indisponíveis nessa tela. A próxima etapa é obter o novo diagnóstico no
aparelho que conserva o Blob e corrigir a exceção comprovada.

Para reverter esta release, publique uma nova versão do frontend com o conteúdo
anterior e uma nova identidade de cache. Preserve o IndexedDB e os rascunhos.
Uma reversão não restaura nem modifica fotos/dados do servidor.
