import { getMeta, updateFiscalCorrectionDraft } from './db.js?v=2026.10.23.2';
import { normalizeText } from './core.js?v=2026.10.23.2';

export function fiscalDraftKey(user, recordId, route, aclRevision = '') {
  if (!user || !recordId || route?.routingVersion !== 'FISCAL_ASSIGNED' || !route.routingRequestId || !route.assignmentRevision) throw new Error('Solicitação fiscal incompleta. Atualize a lista.');
  const identity = [normalizeText(user).replace(/\s+/g, ' '), recordId, route.routingRequestId, route.assignmentRevision];
  if (aclRevision) identity.push(aclRevision);
  return `fiscalCorrection:${JSON.stringify(identity)}`;
}

export function fiscalDraftStorage(key) {
  if (!key?.startsWith('fiscalCorrection:')) throw new Error('Rascunho fiscal inválido.');
  const update = mutate => updateFiscalCorrectionDraft(key, mutate);
  const conflict = () => Object.assign(new Error('O rascunho mudou em outra aba. Abra novamente a correção.'), { code: 'LOCAL_RECORD_CHANGED' });
  const stamp = previous => new Date(Math.max(Date.now(), Date.parse(previous || '') + 1 || 0)).toISOString();
  return {
    getRecord: async () => (await getMeta(key))?.record || null,
    putRecord: async (record, options = {}) => (await update(draft => {
      if (options.expectedUpdatedAt != null && String(draft.record?.updatedAt || '') !== options.expectedUpdatedAt) throw conflict();
      return { ...draft, record: { ...record, fiscalDraftKey: key, updatedAt: stamp(draft.record?.updatedAt) } };
    })).record,
    getPhoto: async (_id, index) => (await getMeta(key))?.photos?.[index] || null,
    getPhotosForRecord: async () => Object.values((await getMeta(key))?.photos || {}),
    putPhotoAndRecord: async (record, photoIndex, blob, uploadKey, details = {}) => {
      const saved = await update(draft => {
        if ((Object.hasOwn(details, 'expectedUploadKey') || Object.hasOwn(details, 'expectedRecordStatus')) && (!draft.record
          || Object.hasOwn(details, 'expectedRecordStatus') && draft.record.status !== details.expectedRecordStatus
          || Object.hasOwn(details, 'expectedUploadKey') && String(draft.record.photoStates?.[photoIndex - 1]?.uploadKey || '') !== details.expectedUploadKey)) throw conflict();
        const current = draft.record;
        // A photo may finish after another tab has saved newer correction data.
        // Merge only this slot in that case, as the Campo transaction does.
        const next = current && current.updatedAt !== record.updatedAt ? current : record;
        const states = record.photoStates.map((state, index) => index === photoIndex - 1 ? state : current?.photoStates?.[index] || state);
        return { record: { ...next, photoStates: states, fiscalDraftKey: key, updatedAt: stamp(current?.updatedAt) },
          photos: { ...draft.photos, [photoIndex]: { ...details, recordId: record.recordId, photoIndex, blob, uploadKey } } };
      });
      return { record: saved.record, photo: saved.photos[photoIndex] };
    },
    deletePhoto: async (_id, index, expectedKey = '') => {
      let deleted = false;
      await update(draft => {
        const photo = draft.photos?.[index];
        if (!photo || expectedKey && photo.uploadKey !== expectedKey) return draft;
        const photos = { ...draft.photos }; delete photos[index]; deleted = true;
        return { ...draft, photos };
      });
      return deleted;
    }
  };
}
