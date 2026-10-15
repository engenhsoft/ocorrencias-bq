# Conta mestra Fiscal — 15/10/2026

Release frontend/backend `2026.10.15.1`. Repositório, Apps Script, deployment e fontes operacionais existentes preservados.

## Uso

Selecione **Fiscal** no login. A conta mestra mostra **Gerenciar fiscais**, onde é possível criar usuários, vincular uma ou várias das seis Bases oficiais, editar vínculos, ativar/desativar acessos e redefinir senhas individuais. O nome de um usuário existente permanece fixo para evitar duplicação acidental. Uma edição exige a revisão atual do cadastro.

A conta mestra consulta as seis Bases. Os demais fiscais continuam restritos às Bases atribuídas e somente leitura. Nenhum acesso fiscal, inclusive o mestre, aprova, cria, corrige ou apaga ocorrências.

A seção **Alterar senha da conta mestra** exige a senha atual e encerra todas as suas sessões anteriores. Senhas têm entre 12 e 128 caracteres e confirmação na interface. Os campos são limpos após envio/logout; nenhuma senha é persistida no navegador ou incluída no Git.

## Autorização e preservação

O servidor valida a sessão e o cadastro privado em cada operação administrativa, novamente depois de adquirir o lock de escrita. Campos de privilégio enviados pelo cliente são ignorados. Sessões do Campo/Supervisor e fiscais comuns não administram usuários. Alterar Bases, senha ou situação gera uma nova revisão e revoga imediatamente tokens anteriores.

O cadastro usa a propriedade privada já existente `FISCAL_ACCOUNTS_V1`; a conta mestra é marcada como `kind: master`. Respostas de cadastro/lista nunca incluem salt ou hash. A criação pública sempre grava `kind: fiscal`; ela não pode promover usuários nem alterar ou desativar a mestra. A gravação verifica o limite de 8.500 bytes antes de substituir a propriedade, preservando cadastros no erro. Metadados incluem data e responsável pela última edição.

## Instalação no projeto oficial

Aplicar `patches/backend-fiscal-admin-20261015.patch` sobre o fonte oficial `2026.10.14.4` em `ApprovalIntegrity20260911.gs`. O patch já inclui as funções de `backend/FiscalAdmin20261015.gs`: não instalar as duas cópias. Ele acrescenta apenas três rotas protegidas e estende a resposta fiscal com `canManageFiscals`. Tokens Campo/Supervisor conservam o formato anterior.

O proprietário provisiona a primeira mestra exclusivamente pelo editor, usando `configureFiscalMaster_({user, salt, passwordHash})`. O hash deve ser preparado de forma privada com o script existente `scripts/prepare-fiscal-config.py`. O auxiliar se recusa a sobrescrever qualquer usuário ou criar uma segunda mestra. Não existe rota HTTP de bootstrap. Remover qualquer função temporária contendo configuração real antes de finalizar. Nenhum cadastro real ou senha pertence ao repositório.

Publicar o backend no mesmo deployment antes do frontend. O frontend não cria contas se o backend não estiver compatível. Preservar o arquivo auxiliar, manifesto, propriedades existentes e configuração de execução/acesso.

## Verificação

- `node tests/fiscal-admin.mjs BACKEND.gs`: 17 testes de gestão, recusa de perfis, revogação, concorrência, promoção adulterada, proteção da mestra, senha e capacidade.
- `node tests/operational-features.mjs BACKEND.gs`: 42 testes existentes, incluindo escopo fiscal por Base/documento/foto e compatibilidade das sessões.
- `node tests/login-supervisor-decimal.mjs`: 17 testes existentes.
- `node tests/supervisor-load-completion.mjs BACKEND.gs`: 26 testes existentes.
- `node tests/correction-persistence.mjs BACKEND.gs`: 53 testes existentes.
- `node tests/features-ui.mjs BACKEND.gs`: 24 grupos em Chromium desktop 1440 px e mobile 390 px; criação, edição, desativação, reload, logout e fluxos anteriores; zero requests em produção.
- `node tests/pwa-release.mjs`: coerência dos assets/cache da release.

179 checagens/grupos contados aprovados, zero falhas finais. Validação do PWA e sintaxe também aprovadas. Safari/iPhone físico não foi usado. Testes não criaram nem alteraram ocorrências reais.
