// Isolated CPU work; the worker never receives a session or calls the backend.
importScripts('./vendor/exceljs-4.4.0.min.js');
self.onmessage = async event => {
  try {
    const { buildOccurrenceWorkbook } = await import('./occurrence-excel.js?v=2026.10.30.1');
    const output = await buildOccurrenceWorkbook(event.data.entries, { onProgress: progress => self.postMessage({ progress }) });
    const bytes = new Uint8Array(output.bytes).buffer;
    self.postMessage({ bytes, filename: output.filename }, [bytes]);
  } catch (error) { self.postMessage({ error: error.message || 'Falha ao gerar Excel.' }); }
};
