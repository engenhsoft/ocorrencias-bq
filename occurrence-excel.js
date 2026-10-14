import { statusLabel, operationalDate, isUuid } from './core.js?v=2026.10.14.4';

const moneyFormat = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
const decimalFormat = '#,##0.###';
const string = value => String(value ?? '');
const number = value => value != null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const date = value => {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? string(value) : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Bahia' }).format(parsed);
};
const cancelled = () => Object.assign(new Error('Exportação cancelada.'), { code: 'EXPORT_CANCELLED' });

// Explicit projection: no tokens, upload keys, fingerprints or private audit payloads.
export function excelRecordData(record) {
  const data = {};
  for (const field of ['recordId', 'occurrenceNumber', 'status', 'project', 'base', 'contract', 'team', 'crewLeader', 'user', 'registeredAt', 'updatedAt', 'reviewedAt', 'publishedAt', 'otherOccurrenceType', 'pgPostRemoved', 'pgPostInstalled', 'pgConductorStart', 'pgConductorEnd', 'observation', 'supervisor', 'reason', 'supervisorNote']) data[field] = string(record[field]);
  data.totalServices = number(record.totalServices);
  data.occurrenceTypes = (Array.isArray(record.occurrenceTypes) ? record.occurrenceTypes : []).map(string);
  data.transformer = {};
  for (const field of ['removedCode', 'removedCia', 'removedBto', 'newCode', 'newCia', 'newBto']) data.transformer[field] = string(record.transformer?.[field]);
  data.services = (Array.isArray(record.services) ? record.services : []).map(item => ({ code: string(item.code), description: string(item.catalogText || item.description), unit: string(item.unit), quantity: number(item.quantity), referenceValue: number(item.referenceValue), totalValue: number(item.totalValue), contract: string(item.contract || record.contract) }));
  data.materials = (Array.isArray(record.materials) ? record.materials : []).map(item => ({ code: string(item.code), description: string(item.description), unit: string(item.unit), quantity: number(item.quantity) }));
  return data;
}

export async function prepareExcelPhoto(dataUrl) {
  if (!/^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(dataUrl || '')) throw new Error('Foto inválida.');
  const image = new Image();
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Não foi possível abrir a foto.')), 15000);
      image.onload = () => { clearTimeout(timer); resolve(); };
      image.onerror = () => { clearTimeout(timer); reject(new Error('Imagem indisponível ou inválida.')); };
      image.src = dataUrl;
    });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Imagem sem dimensões válidas.');
    const scale = Math.min(1, 960 / image.naturalWidth, 960 / image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Não foi possível preparar a fotografia.');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL('image/jpeg', .85), extension: 'jpeg', width: canvas.width, height: canvas.height };
  } finally { image.src = ''; }
}

export async function collectExcelEntries(recordIds, { getRecord, getPhoto, preparePhoto = prepareExcelPhoto, isCurrent = () => true, signal, onProgress = () => {} } = {}) {
  const ids = [...new Set(recordIds)];
  if (!ids.length || ids.some(id => !isUuid(id))) throw new Error('Selecione ocorrências válidas.');
  const check = () => { if (signal?.aborted) throw cancelled(); if (!isCurrent()) throw Object.assign(new Error('A sessão mudou durante a exportação.'), { code: 'AUTH_REQUIRED' }); };
  const entries = []; let photoBytes = 0;
  for (const [position, id] of ids.entries()) {
    check(); onProgress(`Ocorrência ${position + 1}/${ids.length} · Consultando dados`);
    const response = await getRecord(id); check();
    const record = response?.record;
    if (record?.recordId !== id) throw new Error('Os dados de outra ocorrência foram recusados.');
    const data = excelRecordData(record), transformer = data.occurrenceTypes.includes('SUBSTITUIÇÃO DE TRAFO'), slotCount = transformer ? 7 : 5;
    const slots = new Map((Array.isArray(record.photoSlots) ? record.photoSlots : []).filter(slot => Number.isInteger(slot?.photoIndex) && slot.photoIndex >= 1 && slot.photoIndex <= slotCount).map(slot => [slot.photoIndex, slot]));
    const photos = [];
    for (let index = 1; index <= slotCount; index++) {
      check(); onProgress(`Ocorrência ${position + 1}/${ids.length} · Foto ${index}/${slotCount}`);
      let prepared = null, message = 'Foto indisponível / sincronização pendente.';
      if (slots.get(index)?.confirmed === true) {
        try {
          const result = await getPhoto(id, index); check();
          if (result?.recordId !== id || result.photoIndex !== index) message = 'Foto indisponível: UUID ou slot não confirmado.';
          else if (result.available) { prepared = await preparePhoto(result.dataUrl); check(); message = 'Incorporada'; }
          else message = 'Foto indisponível / sincronização pendente.';
        } catch (error) {
          if (['AUTH_REQUIRED', 'FORBIDDEN', 'EXPORT_CANCELLED'].includes(error.code)) throw error;
          message = 'Foto indisponível: não foi possível consultar ou abrir a imagem.';
        }
      }
      if (prepared) {
        if (!/^data:image\/(?:jpeg|png|gif);base64,/.test(prepared.dataUrl || '') || !prepared.width || !prepared.height) { prepared = null; message = 'Foto indisponível: imagem inválida.'; }
        else photoBytes += Math.ceil(prepared.dataUrl.length * .75);
      }
      if (photoBytes > 80 * 1024 * 1024) throw new Error('O Excel ultrapassou o limite de fotos desta exportação. Selecione menos ocorrências.');
      photos.push({ photoIndex: index, ...prepared, message });
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    entries.push({ record: data, photos });
  }
  check(); return entries;
}

function sheet(workbook, name, columns) {
  const result = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  result.columns = columns.map(([header, width, format]) => ({ header, width, style: format ? { numFmt: format } : {} }));
  result.getRow(1).height = 30;
  result.getRow(1).eachCell(cell => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2D50' } }; cell.alignment = { vertical: 'middle', wrapText: true }; });
  return result;
}

export async function buildOccurrenceWorkbook(entries, { ExcelJS = globalThis.ExcelJS, onProgress = () => {} } = {}) {
  if (!ExcelJS?.Workbook) throw new Error('Biblioteca Excel indisponível. Atualize o aplicativo.');
  const workbook = new ExcelJS.Workbook(); workbook.creator = 'Ocorrências B&Q';
  const hasProject = entries.some(entry => entry.record.project);
  const occurrenceColumns = [['Número', 20, '@'], ['UUID', 39, '@'], ['Status', 28], ...(hasProject ? [['Projeto', 24, '@']] : []), ['Sub-base', 20], ['Contrato', 20, '@'], ['Equipe', 22], ['Chefe de turma', 28], ['Usuário', 28], ['Data', 24], ['Tipos', 36], ['Tipo avulso', 26], ['PG poste retirado', 22, '@'], ['PG poste instalado', 22, '@'], ['PG condutor inicial', 22, '@'], ['PG condutor final', 22, '@'], ['Série retirado', 20, '@'], ['CIA retirado', 20, '@'], ['BTO retirado', 20, '@'], ['Série instalado', 20, '@'], ['CIA instalado', 20, '@'], ['BTO instalado', 20, '@'], ['Observação', 55], ['Valor total', 22, moneyFormat], ['Supervisor', 28], ['Conferência em', 24], ['Publicada em', 24], ['Última atualização', 24], ['Motivo / correção solicitada', 50], ['Observação do Supervisor', 50]];
  const occurrences = sheet(workbook, 'OCORRÊNCIAS', occurrenceColumns);
  const services = sheet(workbook, 'SERVIÇOS', [['Ocorrência', 20, '@'], ['UUID', 39, '@'], ['Código', 22, '@'], ['Descrição', 60], ['Unidade', 12, '@'], ['Quantidade', 16, decimalFormat], ['Preço unitário', 22, moneyFormat], ['Total', 22, moneyFormat], ['Contrato', 20, '@']]);
  const materials = sheet(workbook, 'MATERIAIS', [['Ocorrência', 20, '@'], ['UUID', 39, '@'], ['Código', 22, '@'], ['Descrição', 60], ['Unidade', 12, '@'], ['Quantidade', 16, decimalFormat]]);
  const photographs = sheet(workbook, 'FOTOGRAFIAS', [['Ocorrência', 20, '@'], ['UUID', 39, '@'], ['Slot / evidência', 26], ['Situação', 48], ['Imagem incorporada', 46]]);
  const seen = new Set();
  for (const [position, entry] of entries.entries()) {
    const record = entry.record, id = record.recordId;
    if (!isUuid(id) || seen.has(id)) continue; seen.add(id);
    const transformer = record.transformer || {};
    occurrences.addRow([record.occurrenceNumber, id, statusLabel(record.status), ...(hasProject ? [record.project] : []), record.base, record.contract, record.team, record.crewLeader, record.user, date(record.registeredAt), (record.occurrenceTypes || []).join(' / '), record.otherOccurrenceType, record.pgPostRemoved, record.pgPostInstalled, record.pgConductorStart, record.pgConductorEnd, transformer.removedCode, transformer.removedCia, transformer.removedBto, transformer.newCode, transformer.newCia, transformer.newBto, record.observation, record.totalServices, record.supervisor, date(record.reviewedAt), date(record.publishedAt), date(record.updatedAt), record.reason, record.supervisorNote]);
    for (const item of record.services || []) services.addRow([record.occurrenceNumber, id, string(item.code), item.description, string(item.unit), number(item.quantity), number(item.referenceValue), number(item.totalValue), string(item.contract || record.contract)]);
    for (const item of record.materials || []) materials.addRow([record.occurrenceNumber, id, string(item.code), item.description, string(item.unit), number(item.quantity)]);
    for (const photo of entry.photos || []) {
      const label = photo.photoIndex === 6 ? 'Trafo retirado · slot 6' : photo.photoIndex === 7 ? 'Trafo instalado · slot 7' : `Foto geral · slot ${photo.photoIndex}`;
      const row = photographs.addRow([record.occurrenceNumber, id, label, photo.message, photo.dataUrl ? '' : 'Sem imagem disponível']);
      row.height = photo.dataUrl ? 155 : 38;
      if (photo.dataUrl) {
        const scale = Math.min(300 / photo.width, 190 / photo.height, 1), width = Math.max(1, Math.round(photo.width * scale)), height = Math.max(1, Math.round(photo.height * scale));
        const imageId = workbook.addImage({ base64: photo.dataUrl, extension: photo.extension });
        photographs.addImage(imageId, { tl: { nativeCol: 4, nativeColOff: Math.round((320 - width) / 2 * 9525), nativeRow: row.number - 1, nativeRowOff: Math.round((206 - height) / 2 * 9525) }, ext: { width, height }, editAs: 'oneCell' });
      }
    }
    onProgress(`Organizando planilha · ${position + 1}/${entries.length}`);
    if (position % 20 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  for (const worksheet of workbook.worksheets) {
    worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, worksheet.rowCount), column: worksheet.columnCount } };
    worksheet.eachRow((row, index) => { if (index > 1) row.eachCell(cell => { cell.alignment = { vertical: 'middle', wrapText: true }; }); });
  }
  onProgress('Compactando arquivo Excel');
  const bytes = await workbook.xlsx.writeBuffer({ zip: { compression: 'DEFLATE', compressionOptions: { level: 3 } } });
  return { bytes, filename: `Ocorrencias-BQ-${operationalDate()}-${seen.size}.xlsx` };
}

export function writeExcelInWorker(entries, { onProgress = () => {}, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(cancelled()); return; }
    let worker;
    try { worker = new Worker(new URL('./occurrence-excel-worker.js?v=2026.10.14.4', import.meta.url)); }
    catch { reject(new Error('Não foi possível iniciar o Excel. Atualize o aplicativo e tente novamente.')); return; }
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); worker.terminate(); };
    const abort = () => { cleanup(); reject(cancelled()); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('A geração do Excel demorou demais. Selecione menos ocorrências e tente novamente.')); }, 180000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = event => {
      if (event.data?.progress) { onProgress(event.data.progress); return; }
      cleanup();
      if (event.data?.error) reject(new Error(event.data.error)); else resolve(event.data);
    };
    worker.onerror = () => { cleanup(); reject(new Error('Não foi possível gerar o arquivo Excel. Atualize e tente novamente.')); };
    worker.postMessage({ entries });
  });
}

export function downloadOccurrenceExcel(output) {
  const blob = new Blob([output.bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = output.filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
