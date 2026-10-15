#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { analyzeRepository, renderMarkdown } = require('../src/diffAst');

const root = path.resolve(process.argv[2] || process.cwd());
const base = process.argv[3] || 'HEAD';
const python = process.argv[4] || 'python';
const go = process.argv[5] || 'go';
try {
  process.stdout.write(renderMarkdown(analyzeRepository(root, base, { python, go })));
} catch (error) {
  process.stderr.write(`Agent Orchestra: ${error.message}\n`);
  process.exitCode = 2;
}
