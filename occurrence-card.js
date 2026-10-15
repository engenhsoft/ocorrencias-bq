import { escapeHtml, formatCurrency, formatDateTime, statusLabel, statusTone, normalizeOccurrenceTypes, driveFileId } from './core.js?v=2026.10.15.5';

// Shared presentation only. Actions and permissions stay with each profile.
export function cardMetadataMarkup(entries) {
  return entries.map(([label, value]) => `<div class="record-meta"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
}

export function cardThumbnailsMarkup(record, slots, fiscal = false) {
  return slots.map(({ url, photoIndex, label = `Foto ${photoIndex}` }) => {
    const id = escapeHtml(record.recordId), title = escapeHtml(label), fileId = driveFileId(url);
    const attributes = fiscal ? `data-fiscal-photo="${photoIndex}" data-fiscal-record="${id}"` : `data-zoom-src="${escapeHtml(url)}" data-zoom-label="${title}"`;
    return url ? `<button type="button" data-photo-index="${photoIndex}" data-record-photo-id="${id}" ${attributes}${fiscal ? ` aria-label="Ampliar ${title}"` : ''}><img src="${escapeHtml(url)}" alt="${title}" data-fallback-src="${fiscal ? '' : escapeHtml(fileId ? `https://drive.google.com/uc?export=view&id=${encodeURIComponent(fileId)}` : '')}"${fiscal ? ' loading="lazy" decoding="async"' : ''} />${fiscal ? `<span>${title}</span>` : ''}</button>` : `<button type="button" disabled aria-label="${title} indisponível"><span>${fiscal ? title : photoIndex}</span></button>`;
  }).join('');
}

export function fiscalPreviewSlots(record) {
  const transformer = normalizeOccurrenceTypes(record.occurrenceTypes).includes('SUBSTITUIÇÃO DE TRAFO');
  return Array.from({ length: transformer ? 7 : 5 }, (_, index) => {
    const photoIndex = index + 1, slot = (record.photoSlots || []).find(item => item.photoIndex === photoIndex);
    const confirmed = slot?.confirmed === true && (!slot.recordId || slot.recordId === record.recordId);
    const url = confirmed && slot.recordId === record.recordId && /^https:\/\/drive\.google\.com\/thumbnail\?id=[\w-]{25,}&sz=w320$/.test(slot.previewUrl || '') ? slot.previewUrl : '';
    return { photoIndex, confirmed, url, label: photoIndex === 6 ? 'Trafo retirado' : photoIndex === 7 ? 'Trafo instalado' : `Foto ${photoIndex}` };
  });
}

export function fiscalReadOnlyRecord(record) {
  const slots = fiscalPreviewSlots(record);
  return { ...record, fiscalView: true, photos: slots.slice(0, 5).map(slot => slot.url), transformerPhotos: { removed: slots[5]?.url || '', installed: slots[6]?.url || '' }, photoStates: slots.map(slot => ({ photoIndex: slot.photoIndex, confirmed: slot.confirmed, serverUrl: slot.url })) };
}

export function fiscalCardMarkup(record) {
  const slots = fiscalPreviewSlots(record), count = slots.slice(0, 5).filter(slot => slot.confirmed).length;
  const evidences = slots.length > 5 ? ` · ${slots.slice(5).filter(slot => slot.confirmed).length}/2 evidências do Trafo` : '';
  const types = normalizeOccurrenceTypes(record.occurrenceTypes).map(type => type === 'OUTRO' && record.otherOccurrenceType ? `${type} — ${record.otherOccurrenceType}` : type).join(' · ');
  const metadata = cardMetadataMarkup([['Sub-base', record.base || '—'], ['Contrato', record.contract || '—'], ['Equipe', record.team || '—'], ['Chefe de turma', record.crewLeader || '—'], ['Valor desta ocorrência', formatCurrency(record.totalServices)], ['Registrado em', formatDateTime(record.registeredAt)], ['Enviado por', record.user || '—']]);
  const id = escapeHtml(record.recordId);
  return `<article class="record-card supervisor-card supervisor-card--pending fiscal-card" data-fiscal-card="${id}"><div class="supervisor-card__content"><header class="record-card__header"><div><h3>Ocorrência ${escapeHtml(record.occurrenceNumber || '—')}</h3><small>${id}</small></div><span class="status-chip status-chip--${statusTone(record.status)}">${escapeHtml(statusLabel(record.status, count))}</span></header><p>${escapeHtml(types || 'Tipo não informado')}</p><div class="record-card__body">${metadata}</div><span class="photo-count">▧ ${count}/5 fotos gerais confirmadas${evidences}</span><div class="supervisor-thumbs">${cardThumbnailsMarkup(record, slots, true)}</div><footer class="record-card__footer"><button class="button button--primary" type="button" data-fiscal-detail="${id}">VISUALIZAR</button><button class="button button--ghost" type="button" data-export-record="${id}">GERAR PDF</button><button class="button button--ghost" type="button" data-export-excel="${id}">GERAR EXCEL</button></footer></div></article>`;
}
