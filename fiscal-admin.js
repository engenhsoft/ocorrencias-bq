import { escapeHtml, formatDateTime } from './core.js?v=2026.10.15.3';
import { api } from './api.js?v=2026.10.15.3';

export function createFiscalAdmin({ getSession, getRevision, onLogout }) {
  const $ = selector => document.querySelector(selector);
  const panel = $('#fiscalAdminPanel'), form = $('#fiscalAccountForm'), passwordForm = $('#fiscalMasterPasswordForm');
  let accounts = [], bases = [], editing = null, loading = false, saving = false, generation = 0;
  const allowed = () => getSession()?.role === 'fiscal' && getSession()?.canManageFiscals === true;
  const current = (revision, token, run) => getRevision() === revision && getSession()?.token === token && generation === run && allowed();
  const status = (text, kind = '') => { const host = $('#fiscalAdminStatus'); host.textContent = text; host.className = 'form-message' + (kind ? ' is-' + kind : ''); };
  function errorMessage(error) { status(error.message || 'Não foi possível concluir. Atualize e tente novamente.', 'error'); if (error.code === 'AUTH_REQUIRED') onLogout(); }
  function busy(value) { saving = value; for (const control of form.elements) control.disabled = value; $('#fiscalAdminRefresh').disabled = value; for (const button of panel.querySelectorAll('[data-fiscal-edit]')) button.disabled = value; }
  function newAccount() {
    editing = null; form.reset(); $('#fiscalAccountUser').readOnly = false;
    $('#fiscalAccountPassword').required = true; $('#fiscalAccountPasswordConfirm').required = true;
    $('#fiscalAccountTitle').textContent = 'Novo fiscal'; $('#fiscalAccountPasswordHint').textContent = 'Defina uma senha com pelo menos 12 caracteres.';
    $('#fiscalAccountActive').checked = true;
  }
  function render() {
    $('#fiscalAccountBases').innerHTML = bases.map(base => `<label class="checkbox-label"><input type="checkbox" name="fiscalBase" value="${escapeHtml(base)}"/><span>${escapeHtml(base)}</span></label>`).join('');
    $('#fiscalCorrectionBases').innerHTML = bases.map(base => `<label class="checkbox-label"><input type="checkbox" name="fiscalCorrectionBase" value="${escapeHtml(base)}"/><span>${escapeHtml(base)}</span></label>`).join('');
    $('#fiscalAccountsList').innerHTML = accounts.length ? accounts.map(account => `<article class="fiscal-account-card"><div><strong>${escapeHtml(account.user)}</strong><span class="status-chip">${account.active ? 'Ativo' : 'Desativado'}</span><p>${account.bases.map(escapeHtml).join(' · ')}</p><small>Principal: ${(account.correctionBases || []).map(escapeHtml).join(' · ') || 'não definido'}</small>${account.updatedAt ? `<small>Atualizado em ${escapeHtml(formatDateTime(account.updatedAt))}</small>` : ''}</div><button type="button" class="button button--ghost" data-fiscal-edit="${escapeHtml(account.user)}">Editar</button></article>`).join('') : '<p>Nenhum fiscal cadastrado. Crie o primeiro acesso abaixo.</p>';
    newAccount();
  }
  async function refresh() {
    if (!allowed() || loading || saving) return;
    const { token } = getSession(), revision = getRevision(), run = generation;
    loading = true; $('#fiscalAdminRefresh').disabled = true; status('Carregando usuários fiscais…');
    try {
      const result = await api.listFiscalAccounts(token);
      if (!current(revision, token, run)) return;
      if (!Array.isArray(result.accounts) || !Array.isArray(result.bases) || result.masterUser !== getSession().user) throw new Error('O servidor retornou um cadastro incompleto.');
      accounts = result.accounts; bases = result.bases; render(); status(`${accounts.length} usuários fiscais cadastrados.`);
    } catch (error) { if (current(revision, token, run)) errorMessage(error); }
    finally { if (current(revision, token, run)) { loading = false; $('#fiscalAdminRefresh').disabled = false; } }
  }
  function edit(user) {
    if (!allowed() || saving || loading) return;
    const account = accounts.find(item => item.user === user); if (!account) return;
    newAccount(); editing = account; $('#fiscalAccountTitle').textContent = 'Editar fiscal';
    $('#fiscalAccountUser').value = account.user; $('#fiscalAccountUser').readOnly = true;
    $('#fiscalAccountActive').checked = account.active;
    $('#fiscalAccountPassword').required = false; $('#fiscalAccountPasswordConfirm').required = false;
    $('#fiscalAccountPasswordHint').textContent = 'Deixe a senha vazia para manter a atual. Preencha para redefinir.';
    for (const input of form.querySelectorAll('[name="fiscalBase"]')) input.checked = account.bases.includes(input.value);
    for (const input of form.querySelectorAll('[name="fiscalCorrectionBase"]')) input.checked = (account.correctionBases || []).includes(input.value);
    status('Altere as Bases, a situação ou a senha e salve o cadastro.'); form.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!allowed() || saving || loading) return;
    const password = $('#fiscalAccountPassword').value, confirmation = $('#fiscalAccountPasswordConfirm').value;
    if (password !== confirmation) { status('As senhas não correspondem.', 'error'); return; }
    const selected = [...form.querySelectorAll('[name="fiscalBase"]:checked')].map(input => input.value);
    if (!selected.length) { status('Selecione pelo menos uma Base.', 'error'); return; }
    const correctionBases = [...form.querySelectorAll('[name="fiscalCorrectionBase"]:checked')].map(input => input.value);
    if (correctionBases.some(base => !selected.includes(base))) { status('O Fiscal principal deve ter acesso à mesma Base.', 'error'); return; }
    const payload = { correctionBases, mode: editing ? 'update' : 'create', user: $('#fiscalAccountUser').value.trim(), bases: selected, active: $('#fiscalAccountActive').checked, expectedRevision: editing?.revision || '' };
    if (password) payload.password = password;
    const { token } = getSession(), revision = getRevision(), run = generation;
    busy(true); status('Salvando cadastro…');
    // Clear secret inputs before the network request; never put passwords in storage.
    $('#fiscalAccountPassword').value = ''; $('#fiscalAccountPasswordConfirm').value = '';
    try {
      const result = await api.saveFiscalAccount(token, payload);
      if (!current(revision, token, run)) return;
      if (result.account?.user !== payload.user || !Array.isArray(result.account.bases) || !result.account.revision) throw new Error('O servidor não confirmou o cadastro. Atualize a lista antes de tentar novamente.');
      accounts = accounts.filter(item => item.user !== result.account.user).concat(result.account).sort((a, b) => a.user.localeCompare(b.user, 'pt-BR'));
      render(); status('Cadastro salvo. Alterações de acesso valem imediatamente; sessões anteriores foram invalidadas.', 'success');
    } catch (error) { if (current(revision, token, run)) errorMessage(error); }
    finally { delete payload.password; if (current(revision, token, run)) busy(false); }
  });
  passwordForm.addEventListener('submit', async event => {
    event.preventDefault(); if (!allowed() || saving || loading) return;
    const currentPassword = $('#fiscalMasterCurrentPassword').value, newPassword = $('#fiscalMasterNewPassword').value;
    if (newPassword !== $('#fiscalMasterPasswordConfirm').value) { status('As novas senhas não correspondem.', 'error'); return; }
    const { token } = getSession(), revision = getRevision(), run = generation;
    saving = true; for (const control of passwordForm.elements) control.disabled = true; passwordForm.reset();
    try {
      await api.changeFiscalMasterPassword(token, currentPassword, newPassword);
      if (current(revision, token, run)) { onLogout(); $('#loginMessage').textContent = 'Senha da conta mestra alterada. Entre novamente com a nova senha.'; }
    } catch (error) { if (current(revision, token, run)) errorMessage(error); }
    finally { if (current(revision, token, run)) { saving = false; for (const control of passwordForm.elements) control.disabled = false; } }
  });
  panel.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button || !allowed()) return;
    if (button.dataset.fiscalEdit) edit(button.dataset.fiscalEdit);
    if (button.id === 'fiscalAccountCancel' && !saving) { newAccount(); status('Preencha o cadastro do novo fiscal.'); }
    if (button.id === 'fiscalAdminRefresh') void refresh();
  });
  function reset() {
    generation++; accounts = []; bases = []; editing = null; loading = false; saving = false;
    panel.hidden = true; $('#fiscalAdminToggle').hidden = true; $('#fiscalAdminToggle').setAttribute('aria-expanded', 'false');
    $('#fiscalCorrectionBases').innerHTML = bases.map(base => `<label class="checkbox-label"><input type="checkbox" name="fiscalCorrectionBase" value="${escapeHtml(base)}"/><span>${escapeHtml(base)}</span></label>`).join('');
    $('#fiscalAccountsList').innerHTML = ''; $('#fiscalAccountBases').innerHTML = ''; $('#fiscalCorrectionBases').innerHTML = ''; status('');
    form.reset(); passwordForm.reset(); for (const control of [...form.elements, ...passwordForm.elements]) control.disabled = false;
    $('#fiscalAdminRefresh').disabled = false;
  }
  $('#fiscalAdminToggle').addEventListener('click', () => {
    if (!allowed()) return;
    panel.hidden = !panel.hidden; $('#fiscalAdminToggle').setAttribute('aria-expanded', String(!panel.hidden));
    if (panel.hidden) { $('#fiscalAccountPassword').value = ''; $('#fiscalAccountPasswordConfirm').value = ''; passwordForm.reset(); }
    else void refresh();
  });
  function enter() { reset(); $('#fiscalAdminToggle').hidden = !allowed(); }
  return { enter, reset };
}
