'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');

function scanInWorker(root, { python, go, cacheDir, onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'projectMapWorker.js'), {
      workerData: { root, options: { python, go, cacheDir } }
    });
    let settled = false;
    const finish = (error, report) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(report);
    };
    const abort = () => {
      worker.terminate();
      const error = new Error('Mapeamento cancelado.');
      error.name = 'AbortError';
      finish(error);
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) return abort();
    worker.on('message', message => {
      if (message?.type === 'progress') onProgress?.(message.progress);
      else if (message?.type === 'report') finish(null, message.report);
      else if (message?.type === 'error') {
        const error = new Error(message.message);
        error.name = message.name || 'Error';
        finish(error);
      }
    });
    worker.on('error', finish);
    worker.on('exit', code => {
      if (!settled) finish(new Error(`Mapeador terminou antes de concluir (código ${code}).`));
    });
  });
}

module.exports = { scanInWorker };
