import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (name) => readFile(new URL(name, root), 'utf8');
const [coreSource, appSource, htmlSource] = await Promise.all([read('core.js'), read('app.js'), read('index.html')]);
const core = await import(`data:text/javascript;base64,${Buffer.from(coreSource).toString('base64')}`);
const extract = (name) => {
  const source = appSource.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`, 'm'))?.[0];
  assert.ok(source, `${name} encontrado`);
  return source;
};

const requested = { action: 'CORRECAO_SOLICITADA' };
const resent = { action: 'CORRECAO_REENVIADA' };
const waiting = core.RECORD_STATUS.WAITING_SUPERVISOR;
assert.equal(core.correctedAfterResend({ recordId: 'a', status: waiting, audit: { timeline: [] } }), false);
assert.equal(core.correctedAfterResend({ recordId: 'a', status: waiting, audit: { timeline: [requested, resent] } }), true);
assert.equal(core.correctedAfterResend({ recordId: 'b', status: waiting, audit: { timeline: [resent] } }), false);
assert.equal(core.correctedAfterResend({ recordId: 'a', status: core.RECORD_STATUS.REJECTED, audit: { timeline: [requested, resent] } }), false);
assert.equal(core.correctedAfterResend({ recordId: 'a', status: waiting, audit: { timeline: [resent, requested] } }), false);
assert.match(appSource, /correctedAfterResend\(record\)/);

const request = { status: 'OPEN', reason: 'FOTOS_PENDENTES', recipient: 'equipe-a', supervisor: 'Supervisor' };
const photoPending = { recordId: 'uuid-a', status: core.RECORD_STATUS.SYNCING_PHOTOS, audit: { photoSyncRequest: request } };
assert.equal(core.openPhotoSyncRequest(photoPending, 'equipe-a'), request);
assert.equal(core.openPhotoSyncRequest(photoPending, 'equipe-b'), null);
assert.equal(core.openPhotoSyncRequest({ ...photoPending, recordId: 'uuid-b', status: waiting }), null);
assert.equal(core.openPhotoSyncRequest({ ...photoPending, audit: { photoSyncRequest: { ...request, status: 'RESOLVED' } } }), null);

async function exercisePhotoSync({ local = true, blobs = [3], resolved = true } = {}) {
  const events = [];
  const feedback = new Map();
  const attempts = new Set();
  const context = {
    session: { role: 'field', user: 'equipe-a', token: 'session' }, sessionRevision: 1, mineRecords: [photoPending],
    photoSyncAttempts: attempts, photoSyncFeedback: feedback,
    renderPhotoSyncRequests: () => events.push('render'),
    getRecord: async (id) => { events.push(`local:${id}`); return local ? { recordId: id, user: 'equipe-a' } : null; },
    getPhotosForRecord: async () => blobs.map((index) => ({ photoIndex: index, blob: {} })),
    api: { getRecordState: async (token, id) => {
      events.push(`remote:${id}`);
      return { status: core.RECORD_STATUS.SYNCING_PHOTOS, photoStates: [1, 2].map((index) => ({ photoIndex: index, confirmed: true })), record: { photos: ['foto1', 'foto2'] } };
    } },
    normalizePhotoStates: core.normalizePhotoStates, requiredPhotoDeficit: core.requiredPhotoDeficit, normalizeArray: core.normalizeArray, sameUser: core.sameUser,
    RECORD_STATUS: core.RECORD_STATUS, openPhotoSyncRequest: core.openPhotoSyncRequest,
    syncSingleRecord: async (id) => {
      events.push(`sync:${id}`);
      return { status: waiting, audit: { photoSyncRequest: { ...request, status: resolved ? 'RESOLVED' : 'OPEN' } } };
    },
    refreshMine: async () => events.push('refresh'),
    ApiError: class ApiError extends Error {}, friendlyError: (error) => error.message,
    toast: (message, tone) => events.push(`toast:${tone}:${message}`)
  };
  const sync = vm.runInNewContext(`${extract('syncRequestedPhotos')}\nsyncRequestedPhotos`, context);
  await sync('uuid-a');
  return { events, feedback, attempts };
}

const success = await exercisePhotoSync();
assert.equal(success.events.filter((item) => item === 'sync:uuid-a').length, 1);
assert.equal(success.events.includes('refresh'), true);
assert.equal(success.feedback.size, 0);
assert.equal(success.attempts.size, 0);
const missing = await exercisePhotoSync({ blobs: [] });
assert.equal(missing.events.includes('sync:uuid-a'), false);
assert.match(missing.feedback.get('uuid-a'), /fotos necessárias/);
const otherDevice = await exercisePhotoSync({ local: false });
assert.equal(otherDevice.events.some((item) => item.startsWith('remote:')), false);
assert.equal(otherDevice.events.includes('sync:uuid-a'), false);
const unconfirmed = await exercisePhotoSync({ resolved: false });
assert.equal(unconfirmed.events.includes('refresh'), false);
assert.match(unconfirmed.feedback.get('uuid-a'), /não foram confirmadas/);

assert.match(appSource, /api\.supervisorAction\(requestSession\.token, 'request_photo_sync', recordId\)/);
assert.match(appSource, /supervisorMutationRunning = true/);
assert.match(appSource, /photoSyncAttempts\.has\(recordId\)/);
assert.match(htmlSource, /id="requestPhotoSyncButton"/);
assert.match(htmlSource, /id="photoSyncRequests"/);

const seen = new Map();
let shown = 0;
const notice = { open: false, showModal() { this.open = true; shown += 1; } };
const noticeContext = {
  session: { role: 'field' }, elements: { updateDialog: { open: false }, releaseNoticeDialog: notice },
  APP_VERSION: core.APP_VERSION,
  navigator: { serviceWorker: { controller: { scriptURL: 'https://engenhsoft.github.io/ocorrencias-bq/service-worker.js?v=2026.09.27.2' } } },
  URL,
  localStorage: { getItem: (key) => seen.get(key), setItem: (key, value) => seen.set(key, value) },
  RELEASE_NOTICE_KEY: `ocorrencias-bq-update-notice-seen-${core.APP_VERSION}`, console
};
const showNotice = vm.runInNewContext(`${extract('showReleaseNoticeOnce')}\nshowReleaseNoticeOnce`, noticeContext);
showNotice();
assert.equal(shown, 0, 'worker anterior impede aviso antecipado');
noticeContext.navigator.serviceWorker.controller.scriptURL = `https://engenhsoft.github.io/ocorrencias-bq/service-worker.js?v=${core.APP_VERSION}`;
noticeContext.elements.updateDialog.open = true;
showNotice();
assert.equal(shown, 0, 'atualização aberta tem prioridade');
noticeContext.elements.updateDialog.open = false;
showNotice();
assert.equal(shown, 1);
notice.open = false;
seen.set(noticeContext.RELEASE_NOTICE_KEY, '1');
showNotice();
assert.equal(shown, 1);
assert.match(appSource, /releaseNoticeDialog\.addEventListener\('close'/);
assert.match(htmlSource, /id="releaseNoticeAcknowledge"[^>]*>Entendi/);

console.log('photo-sync-notice: verificações focadas aprovadas');
