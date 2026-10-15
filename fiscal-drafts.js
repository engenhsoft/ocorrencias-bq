import { getMeta, updateFiscalCorrectionDraft } from './db.js?v=2026.10.15.3';
import { normalizeText } from './core.js?v=2026.10.15.3';

export function fiscalDraftKey(user, recordId, route) {
  if (!user || !recordId || route?.routingVersion !== 'FISCAL_ASSIGNED' || !route.routingRequestId || !route.assignmentRevision) throw new Error('Solicitação fiscal incompleta. Atualize a lista.');
  return `fiscalCorrection:${JSON.stringify([normalizeText(user), recordId, route.routingRequestId, route.assignmentRevision])}`;
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
        const states = record.photoStates.map((state, index) => index === photoIndex - 1 ? state : draft.record?.photoStates?.[index] || state);
        return { record: { ...record, photoStates: states, fiscalDraftKey: key, updatedAt: stamp(draft.record?.updatedAt) },
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
