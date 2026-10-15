'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { scanProject } = require('./projectMap');

scanProject(workerData.root, {
  ...workerData.options,
  onProgress: progress => parentPort.postMessage({ type: 'progress', progress })
}).then(report => parentPort.postMessage({ type: 'report', report }), error => {
  parentPort.postMessage({ type: 'error', name: error.name, message: error.message });
});
