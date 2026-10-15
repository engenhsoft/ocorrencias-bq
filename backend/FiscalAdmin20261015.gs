// Included in the existing official backend; no public master bootstrap route.
function fiscalOfficialBases_() {
  return ['ASSÚ', 'CAICÓ', 'CARAÚBAS', 'CURRAIS NOVOS', 'MOSSORÓ', 'PAU DOS FERROS'];
}

function fiscalPublicAccount_(account) {
  return { user: account.user, bases: account.bases.slice(), correctionBases: (account.correctionBases || []).slice(), active: account.active === true,
    revision: account.revision, updatedAt: account.updatedAt || '', updatedBy: account.updatedBy || '' };
}

function requireFiscalMaster_(token) {
  const auth = requireSession_(token, ['fiscal']);
  // Re-read the private account, never trust a client or token management flag.
  const account = fiscalAccount_(auth.user);
  if (account.kind !== 'master' || account.revision !== auth.aclRevision) throw apiError_('FORBIDDEN', 'Somente a conta mestra pode gerenciar fiscais.');
  return auth;
}

function writeFiscalAccounts_(accounts) {
  const serialized = JSON.stringify(accounts);
  if (Utilities.newBlob(serialized).getBytes().length > 8500) throw apiError_('FISCAL_CAPACITY', 'O cadastro atingiu o limite de armazenamento. Contate o administrador.');
  PropertiesService.getScriptProperties().setProperty('FISCAL_ACCOUNTS_V1', serialized);
}

function fiscalPasswordConfiguration_(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw apiError_('INVALID_FISCAL_PASSWORD', 'Use uma senha entre 12 e 128 caracteres.');
  const salt = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  return { salt: salt, passwordHash: sha256_(salt + '\n' + password) };
}

function listFiscalAccounts_(payload) {
  const auth = requireFiscalMaster_(payload.token), accounts = fiscalAccounts_();
  return { ok: true, success: true, masterUser: auth.user, bases: fiscalOfficialBases_(), accounts: Object.keys(accounts)
    .map(function (key) { return accounts[key]; }).filter(function (account) { return account && account.kind !== 'master'; })
    .map(fiscalPublicAccount_).sort(function (a, b) { return a.user.localeCompare(b.user, 'pt-BR'); }) };
}

function saveFiscalAccount_(payload) {
  requireFiscalMaster_(payload.token);
  const user = cleanText_(payload.user, 120), mode = payload.mode;
  if (typeof payload.user !== 'string' || payload.user.trim().length > 120 || !user || ['create', 'update'].indexOf(mode) < 0 || typeof payload.active !== 'boolean') throw apiError_('INVALID_FISCAL_CONFIG', 'Informe usuário, situação e operação válidos.');
  const requested = payload.bases;
  if (!Array.isArray(requested) || !requested.length || requested.length > 6) throw apiError_('INVALID_FISCAL_CONFIG', 'Selecione pelo menos uma Base oficial.');
  const bases = requested.map(featureBase_);
  if (bases.some(function (base) { return !base; })) throw apiError_('INVALID_FISCAL_CONFIG', 'Selecione somente Bases oficiais.');
  const correctionBases = payload.correctionBases == null ? null : payload.correctionBases;
  if (correctionBases !== null && (!Array.isArray(correctionBases) || correctionBases.some(function (base) { return bases.indexOf(base) < 0; }))) throw apiError_('INVALID_FISCAL_CONFIG', 'A responsabilidade por correções requer uma Base autorizada.');
  const password = payload.password;
  if (password != null && typeof password !== 'string') throw apiError_('INVALID_FISCAL_PASSWORD', 'Senha inválida.');
  const credential = mode === 'create' || password ? fiscalPasswordConfiguration_(password) : null;
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    // Authorization can have changed while this request was waiting for the lock.
    const auth = requireFiscalMaster_(payload.token), accounts = fiscalAccounts_(), key = fiscalAccountKey_(user), existing = accounts[key];
    if (existing && existing.kind === 'master') throw apiError_('FORBIDDEN', 'O cadastro da conta mestra não pode ser alterado por esta operação.');
    if (mode === 'create' && existing) throw apiError_('FISCAL_EXISTS', 'Este usuário já está cadastrado. Use Editar.');
    if (mode === 'update' && (!existing || !payload.expectedRevision || existing.revision !== payload.expectedRevision)) throw apiError_('FISCAL_CONFLICT', 'O cadastro mudou. Atualize a lista antes de editar novamente.');
    const principals = correctionBases === null ? (existing && existing.correctionBases || []).filter(function (base) { return bases.indexOf(base) >= 0; }) : correctionBases;
    if (payload.active && principals.some(function (base) { return Object.keys(accounts).some(function (id) { const other = accounts[id]; return id !== key && other && other.active && (other.correctionBases || []).indexOf(base) >= 0; }); })) throw apiError_('FISCAL_PRINCIPAL_CONFLICT', 'Esta Base já possui Fiscal principal. Retire a responsabilidade do cadastro atual antes de escolher outro.');
    const now = nowIso_();
    const account = Object.assign({}, existing || {}, credential || {}, { user: existing ? existing.user : user,
      kind: 'fiscal', correctionBases: principals.filter(function (base, index, all) { return all.indexOf(base) === index; }), bases: bases.filter(function (base, index, all) { return all.indexOf(base) === index; }),
      active: payload.active, revision: Utilities.getUuid(), createdAt: existing && existing.createdAt || now, updatedAt: now, updatedBy: auth.user });
    accounts[key] = account; writeFiscalAccounts_(accounts);
    return { ok: true, success: true, account: fiscalPublicAccount_(account) };
  } finally { lock.releaseLock(); }
}

function changeFiscalMasterPassword_(payload) {
  requireFiscalMaster_(payload.token);
  const credential = fiscalPasswordConfiguration_(payload.newPassword);
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const auth = requireFiscalMaster_(payload.token), accounts = fiscalAccounts_(), key = fiscalAccountKey_(auth.user), account = accounts[key];
    if (typeof payload.currentPassword !== 'string' || !constantTimeEquals_(sha256_(account.salt + '\n' + payload.currentPassword), account.passwordHash)) throw apiError_('INVALID_CREDENTIALS', 'A senha atual da conta mestra está incorreta.');
    accounts[key] = Object.assign({}, account, credential, { revision: Utilities.getUuid(), updatedAt: nowIso_(), updatedBy: auth.user });
    writeFiscalAccounts_(accounts);
    return { ok: true, success: true, loginRequired: true };
  } finally { lock.releaseLock(); }
}

// Run only by the Apps Script owner. It accepts a precomputed salted hash and
// refuses to replace an existing master or overwrite any existing fiscal.
function configureFiscalMaster_(configuration) {
  const user = cleanText_(configuration && configuration.user, 120), salt = String(configuration && configuration.salt || '');
  const hash = String(configuration && configuration.passwordHash || '');
  if (!user || salt.length < 32 || salt.length > 128 || !/^[a-f0-9]{64}$/i.test(hash)) throw apiError_('INVALID_FISCAL_CONFIG', 'Informe usuário e hash com salt válidos.');
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const accounts = fiscalAccounts_(), key = fiscalAccountKey_(user);
    if (Object.keys(accounts).some(function (id) { return accounts[id] && accounts[id].kind === 'master'; })) throw apiError_('FISCAL_MASTER_EXISTS', 'Já existe uma conta mestra. Nenhum cadastro foi substituído.');
    if (accounts[key]) throw apiError_('FISCAL_EXISTS', 'Este usuário já está cadastrado. Escolha outra identidade para a conta mestra.');
    const now = nowIso_();
    accounts[key] = { user: user, salt: salt, passwordHash: hash, kind: 'master', bases: fiscalOfficialBases_(), active: true,
      revision: Utilities.getUuid(), createdAt: now, updatedAt: now, updatedBy: 'Proprietário do projeto' };
    writeFiscalAccounts_(accounts);
    return { user: user, kind: 'master', bases: fiscalOfficialBases_(), active: true };
  } finally { lock.releaseLock(); }
}
