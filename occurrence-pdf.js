import { formatCurrency, formatNumber, statusLabel } from './core.js?v=2026.10.15.4';

function documentDateTime(value) {
  if (!value) return 'Não informada';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Bahia' }).format(date);
}
let pdfLibraryPromise;
async function loadPdfLibrary() {
  if (globalThis.PDFLib) return globalThis.PDFLib;
  if (!pdfLibraryPromise) pdfLibraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = new URL('./vendor/pdf-lib-1.17.1.min.js', import.meta.url).href;
    script.onload = () => globalThis.PDFLib ? resolve(globalThis.PDFLib) : reject(new Error('Biblioteca PDF indisponível.'));
    script.onerror = () => { pdfLibraryPromise = null; script.remove(); reject(new Error('Não foi possível carregar a geração de PDF. Tente novamente.')); };
    document.head.append(script);
  });
  return pdfLibraryPromise;
}
export function occurrencePdfFilename(record) {
  const number = String(record.occurrenceNumber || 'SEM_NUMERO').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 80);
  const id = String(record.recordId || '').replace(/[^a-f0-9]/gi, '').slice(0, 8);
  return `OCORRENCIA_${number}_${id}.pdf`;
}
function dataUrlBytes(url) {
  const match = String(url || '').match(/^data:image\/(jpeg|png|webp|gif);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) throw new Error('Fotografia indisponível.');
  return { type: match[1].toLowerCase(), bytes: Uint8Array.from(atob(match[2]), char => char.charCodeAt(0)) };
}
async function normalisePhoto(url) {
  const source = dataUrlBytes(url);
  if (['jpeg', 'png'].includes(source.type)) return source;
  if (typeof document === 'undefined') throw new Error('Formato de fotografia indisponível.');
  const image = new Image(); image.src = url; await image.decode();
  const canvas = document.createElement('canvas'), ratio = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
  canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio)); canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return dataUrlBytes(canvas.toDataURL('image/jpeg', .85));
}

export async function createOccurrencePdf(record, { getPhoto = async () => ({ available: false }), pdfLib, logoBytes } = {}) {
  if (!record?.recordId) throw new Error('UUID da ocorrência ausente.');
  const library = pdfLib || await loadPdfLibrary(), { PDFDocument, StandardFonts, rgb } = library;
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Ocorrência ${record.occurrenceNumber || record.recordId}`); pdf.setAuthor('Ocorrências B&Q'); pdf.setSubject(`UUID ${record.recordId}`);
  const regular = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(.04, .18, .31), teal = rgb(.04, .45, .47), muted = rgb(.34, .42, .48), pale = rgb(.93, .96, .98), line = rgb(.8, .86, .9);
  const PAGE = [595.28, 841.89], MARGIN = 40, WIDTH = PAGE[0] - MARGIN * 2, BOTTOM = 47;
  let logo;
  try {
    const bytes = logoBytes || (await (await fetch(new URL('./assets/icon-192.png', import.meta.url))).arrayBuffer()); logo = await pdf.embedPng(bytes);
  } catch { /* The document still explicitly identifies B&Q if an asset is unavailable. */ }
  let page, y;
  const safe = value => Array.from(String(value ?? '')).map(char => { try { regular.encodeText(char); return char; } catch { return '?'; } }).join('');
  function drawText(value, x, top, size = 9, font = regular, color = navy) { page.drawText(safe(value), { x, y: top - size, size, font, color }); }
  function wrap(value, width, size = 9, font = regular) {
    const lines = [];
    for (const paragraph of safe(value).split(/\r?\n/)) {
      if (!paragraph) { lines.push(''); continue; }
      let current = '';
      for (const word of paragraph.split(/\s+/)) {
        if (font.widthOfTextAtSize(word, size) > width) {
          if (current) { lines.push(current); current = ''; }
          let part = '';
          for (const char of word) { if (font.widthOfTextAtSize(part + char, size) > width && part) { lines.push(part); part = ''; } part += char; }
          current = part;
        } else if (current && font.widthOfTextAtSize(current + ' ' + word, size) > width) { lines.push(current); current = word; }
        else current += (current ? ' ' : '') + word;
      }
      if (current) lines.push(current);
    }
    return lines.length ? lines : [''];
  }
  function newPage() {
    page = pdf.addPage(PAGE); y = PAGE[1] - MARGIN;
    if (logo) page.drawImage(logo, { x: MARGIN, y: y - 35, width: 35, height: 35 });
    drawText('OCORRÊNCIAS B&Q', MARGIN + (logo ? 46 : 0), y - 2, 15, bold);
    drawText(`Ocorrência ${record.occurrenceNumber || 'sem número'}`, MARGIN + (logo ? 46 : 0), y - 23, 10, regular, muted);
    y -= 53; page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE[0] - MARGIN, y }, thickness: 1, color: line }); y -= 16;
  }
  function ensure(height) { if (y - height < BOTTOM) newPage(); }
  function paragraph(value, { size = 9, font = regular, color = navy, gap = 7 } = {}) {
    for (const row of wrap(value, WIDTH, size, font)) { ensure(size + 5); drawText(row, MARGIN, y, size, font, color); y -= size + 4; } y -= gap;
  }
  function section(title) { ensure(40); y -= 5; page.drawRectangle({ x: MARGIN, y: y - 23, width: WIDTH, height: 23, color: pale }); drawText(title, MARGIN + 8, y - 5, 11, bold, teal); y -= 33; }
  function fields(items) { for (const [label, value] of items) if (value !== undefined && value !== null && value !== '') paragraph(`${label}: ${value}`, { gap: 3 }); y -= 4; }
  function table(headers, widths, rows) {
    const scale = WIDTH / widths.reduce((a, b) => a + b, 0); widths = widths.map(w => w * scale);
    function header() { ensure(32); page.drawRectangle({ x: MARGIN, y: y - 23, width: WIDTH, height: 23, color: pale }); let x = MARGIN; headers.forEach((label, i) => { drawText(label, x + 4, y - 6, 8, bold); x += widths[i]; }); y -= 25; }
    header();
    if (!rows.length) { paragraph('Não informado.'); return; }
    for (const row of rows) {
      const cells = row.map((value, i) => wrap(value, widths[i] - 8, 8)); let offset = 0;
      const count = Math.max(...cells.map(cell => cell.length));
      while (offset < count) {
        if (y - Math.min(count - offset, 3) * 11 - 10 < BOTTOM) { newPage(); header(); }
        const capacity = Math.max(1, Math.floor((y - BOTTOM - 9) / 11)), lines = Math.min(count - offset, capacity), height = lines * 11 + 9;
        let x = MARGIN;
        cells.forEach((cell, i) => { cell.slice(offset, offset + lines).forEach((value, n) => drawText(value, x + 4, y - 4 - n * 11, 8)); x += widths[i]; });
        page.drawLine({ start: { x: MARGIN, y: y - height }, end: { x: MARGIN + WIDTH, y: y - height }, color: line, thickness: .5 }); y -= height; offset += lines;
        if (offset < count) { newPage(); header(); }
      }
    }
    y -= 12;
  }
  newPage();
  section('Identificação');
  fields([['Número', record.occurrenceNumber], ['UUID', record.recordId], ['Status', statusLabel(record.status)], ['Responsável', record.user], ['Base', record.base], ['Contrato', record.contract], ['Equipe', record.team], ['Chefe de turma', record.crewLeader], ['Registro', documentDateTime(record.registeredAt)], ['Última atualização', documentDateTime(record.updatedAt)], ['Aprovação / publicação', record.publishedAt ? documentDateTime(record.publishedAt) : '']]);
  section('Dados operacionais');
  fields([['Tipos', (record.occurrenceTypes || []).join(' / ')], ['Tipo OUTRO', record.otherOccurrenceType], ['PG do poste retirado', record.pgPostRemoved], ['PG do poste instalado', record.pgPostInstalled], ['PG do condutor inicial', record.pgConductorStart], ['PG do condutor final', record.pgConductorEnd]]);
  const transformer = record.transformer || {};
  if (Object.values(transformer).some(Boolean)) fields([['Trafo retirado - Série', transformer.removedCode], ['Trafo retirado - CIA', transformer.removedCia], ['Trafo retirado - BTO', transformer.removedBto], ['Trafo instalado - Série', transformer.newCode], ['Trafo instalado - CIA', transformer.newCia], ['Trafo instalado - BTO', transformer.newBto]]);
  paragraph(`Observação: ${record.observation || 'Não informada.'}`);
  section('Serviços');
  table(['Código', 'Descrição', 'Un.', 'Contrato', 'QTD', 'Unitário', 'Total'], [61, 171, 24, 66, 39, 70, 84], (record.services || []).map(item => [item.code, item.catalogText || item.description, item.unit, item.contract || record.contract, formatNumber(item.quantity), formatCurrency(item.referenceValue), formatCurrency(item.totalValue)]));
  paragraph(`Total geral registrado: ${formatCurrency(record.totalServices)}`, { font: bold, size: 11 });
  section('Materiais');
  table(['Código', 'Descrição', 'Unidade', 'Quantidade'], [70, 300, 60, 85], (record.materials || []).map(item => [item.code, item.description, item.unit, formatNumber(item.quantity)]));
  section('Conferência');
  fields([['Status atual', statusLabel(record.status)], ['Supervisor', record.supervisor], ['Data de revisão', record.reviewedAt ? documentDateTime(record.reviewedAt) : ''], ['Motivo / correção solicitada', record.reason], ['Observação do Supervisor', record.supervisorNote]]);
  const slots = Array.isArray(record.photoSlots) ? record.photoSlots : Array.from({ length: (record.occurrenceTypes || []).includes('SUBSTITUIÇÃO DE TRAFO') ? 7 : 5 }, (_, index) => ({ photoIndex: index + 1, confirmed: false }));
  const photoResults = [];
  section('Fotografias e evidências');
  for (const slot of slots) {
    const index = Number(slot.photoIndex), label = index === 6 ? 'Evidência do Trafo retirado' : index === 7 ? 'Evidência do Trafo instalado' : `Foto ${index}`;
    let photo;
    if (slot.confirmed) {
      try { const result = await getPhoto(index); if (result.recordId !== record.recordId || result.photoIndex !== index) throw new Error('Fotografia de outro UUID ou slot recusada.'); if (result.available) photo = await normalisePhoto(result.dataUrl); }
      catch (error) { if (['AUTH_REQUIRED', 'FORBIDDEN'].includes(error.code)) throw error; }
    }
    if (!photo) { paragraph(`${label}: indisponível / sincronização pendente.`, { color: muted }); photoResults.push({ photoIndex: index, available: false }); continue; }
    try {
      const image = photo.type === 'png' ? await pdf.embedPng(photo.bytes) : await pdf.embedJpg(photo.bytes);
      const maxHeight = 315, factor = Math.min(WIDTH / image.width, maxHeight / image.height), width = image.width * factor, height = image.height * factor;
      ensure(height + 43); drawText(label, MARGIN, y, 10, bold); y -= 20;
      page.drawImage(image, { x: MARGIN + (WIDTH - width) / 2, y: y - height, width, height }); y -= height + 22;
      photoResults.push({ photoIndex: index, available: true });
    } catch { paragraph(`${label}: indisponível / sincronização pendente.`, { color: muted }); photoResults.push({ photoIndex: index, available: false }); }
  }
  if (photoResults.some(slot => !slot.available)) paragraph('Documentação fotográfica pendente: consulte os slots indisponíveis acima.', { font: bold, color: muted });
  const pages = pdf.getPages(); pages.forEach((p, index) => {
    p.drawLine({ start: { x: MARGIN, y: 34 }, end: { x: PAGE[0] - MARGIN, y: 34 }, thickness: .5, color: line });
    p.drawText(safe(`Ocorrência ${record.occurrenceNumber || ''} | ${record.recordId.slice(0, 8)}`), { x: MARGIN, y: 21, size: 7, font: regular, color: muted });
    const number = `${index + 1} / ${pages.length}`; p.drawText(number, { x: PAGE[0] - MARGIN - regular.widthOfTextAtSize(number, 8), y: 21, size: 8, font: regular, color: muted });
  });
  return { bytes: await pdf.save(), filename: occurrencePdfFilename(record), pages: pages.length, photos: photoResults };
}

export function downloadOccurrencePdf(output) {
  const blob = new Blob([output.bytes], { type: 'application/pdf' }), url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = output.filename; link.style.display = 'none'; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
