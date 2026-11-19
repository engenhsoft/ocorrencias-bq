// Editor-only maintenance. No HTTP route; caller supplies the owner's closed list.
// Recovery is owner-private and never read by the operational application.
function bqRemovalRawRows_(sheet, width) {
  return sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues();
}
function bqRemovalTables_() {
  const book = spreadsheet_();
  return [[APP.pendingSheet, COL.WIDTH], [APP.officialSheet, COL.WIDTH], [APP.servicesSheet, SERVICE_HEADERS.length],
    [APP.materialsSheet, MATERIAL_HEADERS.length], [APP.historySheet, HISTORY_HEADERS.length]].map(function (entry) {
    const sheet = book.getSheetByName(entry[0]);
    if (!sheet) throw Error('Estrutura operacional ausente: ' + entry[0]);
    return { name: entry[0], width: entry[1], sheet: sheet, rows: bqRemovalRawRows_(sheet, entry[1]) };
  });
}
function bqRemovalPlan_(ids, protectedId) {
  if (ids.length !== 10 || new Set(ids).size !== 10 || ids.includes(protectedId)) throw Error('A lista deve conter exatamente dez UUIDs distintos e excluir a ocorrência protegida.');
  ids.forEach(requireUuid_); requireUuid_(protectedId);
  const tables = bqRemovalTables_(), pending = tables[0];
  const selected = pending.rows.filter(function (row) { return [STATUS.CORRECTION_REQUESTED, STATUS.SYNCING_PHOTOS].includes(operationalStatusFromValues_(row)); });
  const exact = selected.map(function (row) { return String(row[0]); }).sort();
  const expected = ids.concat([protectedId]).sort();
  if (JSON.stringify(exact) !== JSON.stringify(expected)) throw Error('Divergência: o conjunto atual não corresponde às onze pendências autorizadas.');
  const protectedRows = pending.rows.filter(function (row) { return row[0] === protectedId; });
  if (protectedRows.length !== 1 || protectedRows[0][COL.OCCURRENCE_NUMBER - 1] !== '2026 11 10408'
    || protectedRows[0][COL.TEAM - 1] !== 'LV - 02 - MSO' || protectedRows[0][COL.BASE - 1] !== 'MOSSORÓ'
    || protectedRows[0][COL.USER - 1] !== 'JOSE SIMIAO') throw Error('Identidade da ocorrência protegida divergente.');
  if (tables[1].rows.some(function (row) { return ids.includes(String(row[0])); })) throw Error('Há registro selecionado na base publicada; conferir a publicação antes de excluir.');
  // Do not change another occurrence that refers to one selected for removal.
  tables.slice(0, 2).forEach(function (table) { table.rows.forEach(function (row) {
    if (!ids.includes(String(row[0])) && ids.some(function (id) { return JSON.stringify(row).includes(id); })) throw Error('Relacionamento com uma ocorrência não selecionada.');
  }); });
  const folder = photoFolder_(), files = new Map();
  ids.forEach(function (id) {
    const iterator = folder.searchFiles("title contains '" + id + "_'");
    while (iterator.hasNext()) {
      const file = iterator.next();
      if (!file.getName().startsWith(id + '_')) continue;
      files.set(file.getId(), { id: file.getId(), recordId: id, name: file.getName(), size: file.getSize(), mime: file.getMimeType() });
    }
  });
  // Any non-target operational reference makes the photograph shared: retain it.
  const shared = [];
  files.forEach(function (file, id) {
    if (tables.some(function (table) { return table.rows.some(function (row) { return !ids.includes(String(row[0])) && JSON.stringify(row).includes(id); }); })) { shared.push(id); files.delete(id); }
  });
  const monitor = bqMonitorSheet_(), monitorRows = monitor ? bqRemovalRawRows_(monitor, 2).filter(function (row) { return ids.includes(String(row[0])) || ids.includes(safeJson_(row[1], {}).recordId); }) : [];
  const snapshots = tables.map(function (table) { return { name: table.name, width: table.width, rows: table.rows.filter(function (row) { return ids.includes(String(row[0])); }) }; });
  const protectedHistory = tables[4].rows.filter(function (row) { return row[0] === protectedId; });
  return { schema: 1, preparedAt: nowIso_(), ids: ids, protectedId: protectedId, protectedRow: protectedRows[0], protectedHistory: protectedHistory,
    records: selected.filter(function (row) { return ids.includes(String(row[0])); }).map(function (row) { return { recordId: row[0], occurrenceNumber: row[4], status: row[23] }; }),
    snapshots: snapshots, monitorRows: monitorRows, files: Array.from(files.values()), sharedFilesRetained: shared,
    counts: Object.fromEntries(snapshots.map(function (table) { return [table.name, table.rows.length]; })),
    fingerprint: sha256_(publicationJson_(snapshots)), source: APP.spreadsheetId };
}
function bqPrepareRemoval_(ids, protectedId) {
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const props = PropertiesService.getScriptProperties(), key = 'BQ_REMOVAL_PLAN_20261119';
    const existing = props.getProperty(key);
    if (existing) {
      const saved = safeJson_(DriveApp.getFileById(existing).getBlob().getDataAsString(), {});
      if (JSON.stringify(saved.ids) !== JSON.stringify(ids) || saved.protectedId !== protectedId) throw Error('Plano existente tem outra lista.');
      return { ok: true, reused: true, backupFileId: existing, records: saved.records, counts: saved.counts, photos: saved.files.length, protectedId: protectedId };
    }
    const plan = bqRemovalPlan_(ids, protectedId);
    const backup = DriveApp.createFolder('OCORRENCIAS-BQ-recuperacao-restrita-20261119-retencao-30-dias');
    if (backup.getSharingAccess() !== DriveApp.Access.PRIVATE || backup.getEditors().length || backup.getViewers().length) throw Error('A cópia técnica não está privada.');
    plan.backupFolderId = backup.getId(); plan.retainUntil = new Date(Date.now() + 30 * 86400000).toISOString();
    plan.fileCopies = plan.files.map(function (file) {
      const copied = DriveApp.getFileById(file.id).makeCopy(file.name, backup);
      copied.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.VIEW);
      if (copied.getSize() !== file.size || copied.getSharingAccess() !== DriveApp.Access.PRIVATE) throw Error('Cópia de foto não confirmada.');
      return { original: file.id, copy: copied.getId(), size: copied.getSize() };
    });
    const file = backup.createFile('recuperacao-fora-da-base-ativa.json', JSON.stringify(plan), MimeType.PLAIN_TEXT);
    if (file.getSharingAccess() !== DriveApp.Access.PRIVATE) throw Error('O plano de recuperação não está privado.');
    props.setProperty(key, file.getId());
    return { ok: true, backupFileId: file.getId(), fingerprint: plan.fingerprint, records: plan.records, counts: plan.counts,
      photos: plan.files.length, sharedFilesRetained: plan.sharedFilesRetained.length, protectedId: protectedId, retainUntil: plan.retainUntil };
  } finally { lock.releaseLock(); }
}
function bqVerifyProtectedRemoval_(plan) {
  const tables = bqRemovalTables_(), row = tables[0].rows.find(function (row) { return row[0] === plan.protectedId; });
  if (!row) throw Error('Ocorrência protegida ausente.');
  // The fifth photograph may finish normally. Existing slots/keys and identity must remain.
  [COL.ID, COL.USER, COL.TEAM, COL.OCCURRENCE_NUMBER, COL.BASE, COL.TYPES].forEach(function (column) {
    if (String(row[column - 1]) !== String(plan.protectedRow[column - 1])) throw Error('Dados da ocorrência protegida alterados.');
  });
  for (let slot = 1; slot <= 7; slot++) {
    const column = photoUrlColumn_(slot), keyColumn = photoUploadKeyColumn_(slot);
    if (plan.protectedRow[column - 1] && (row[column - 1] !== plan.protectedRow[column - 1] || row[keyColumn - 1] !== plan.protectedRow[keyColumn - 1])) throw Error('Foto protegida divergente.');
  }
  const history = tables[4].rows.filter(function (row) { return row[0] === plan.protectedId; });
  if (!plan.protectedHistory.every(function (before) { return history.some(function (after) { return publicationJson_(before) === publicationJson_(after); }); })) throw Error('Histórico protegido divergente.');
  const remaining = tables.map(function (table) { return { name: table.name, selectedRows: table.rows.filter(function (row) { return plan.ids.includes(String(row[0])); }).length }; });
  return { recordId: row[0], occurrenceNumber: row[4], team: row[3], base: row[39], photos: row.slice(18, 23).filter(Boolean).length,
    status: row[23], historyRows: history.length, remaining: remaining };
}
function bqExecuteRemoval_(ids, protectedId) {
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const props = PropertiesService.getScriptProperties(), fileId = props.getProperty('BQ_REMOVAL_PLAN_20261119');
    if (!fileId) throw Error('Cópia técnica não preparada.');
    const plan = safeJson_(DriveApp.getFileById(fileId).getBlob().getDataAsString(), {});
    if (JSON.stringify(plan.ids) !== JSON.stringify(ids) || plan.protectedId !== protectedId) throw Error('Lista não corresponde ao plano fechado.');
    const progress = safeJson_(props.getProperty('BQ_REMOVAL_PROGRESS_20261119') || '{}', {});
    if (!progress.started) {
      const current = bqRemovalPlan_(ids, protectedId);
      if (current.fingerprint !== plan.fingerprint || JSON.stringify(current.files) !== JSON.stringify(plan.files)) throw Error('Os registros mudaram desde o backup. Revalidar sem excluir por aproximação.');
    }
    bqVerifyProtectedRemoval_(plan);
    // Durable tombstones precede any row/file deletion and survive retries/old releases.
    const union = Array.from(new Set(bqRemovedIds_().concat(ids)));
    if (union.includes(protectedId)) throw Error('UUID protegido presente na política de remoção.');
    props.setProperty(BQ_REMOVAL_PROPERTY, JSON.stringify(union)); BQ_REMOVED_CACHE_ = union;
    props.setProperty('BQ_REMOVAL_PROGRESS_20261119', JSON.stringify({ started: progress.started || nowIso_(), phase: 'DELETING', count: ids.length }));
    bqRemovalTables_().forEach(function (table) { ids.forEach(function (id) { deleteRowsById_(table.sheet, id, 1); }); });
    const monitor = bqMonitorSheet_();
    if (monitor) {
      const rows = bqRemovalRawRows_(monitor, 2);
      for (let index = rows.length - 1; index >= 0; index--) if (ids.includes(String(rows[index][0])) || ids.includes(safeJson_(rows[index][1], {}).recordId)) monitor.deleteRow(index + 2);
    }
    plan.files.forEach(function (file) {
      const response = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(file.id), {
        method: 'delete', headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
      if (![204, 404, 410].includes(response.getResponseCode())) throw Error('Exclusão de arquivo não confirmada: HTTP ' + response.getResponseCode());
      CacheService.getScriptCache().remove('photo-public-' + file.id);
    });
    const protectedState = bqVerifyProtectedRemoval_(plan);
    if (protectedState.remaining.some(function (table) { return table.selectedRows !== 0; })) throw Error('Há linhas selecionadas remanescentes. Retomar o mesmo plano.');
    const result = { ok: true, phase: 'COMPLETE', completedAt: nowIso_(), removed: plan.records, removedCounts: plan.counts,
      removedPhotos: plan.files.length, protected: protectedState, tombstones: ids.length, backupFileId: fileId };
    props.setProperty('BQ_REMOVAL_PROGRESS_20261119', JSON.stringify({ started: progress.started || nowIso_(), completedAt: result.completedAt, phase: 'COMPLETE', count: ids.length }));
    return result;
  } finally { lock.releaseLock(); }
}
