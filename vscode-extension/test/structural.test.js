'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parseSource } = require('../src/structural');

test('PHP detects classes and methods through AST', () => {
  const result = parseSource('<?php class Controller { public function save() { return 1; } }', 'app/Controller.php');
  assert.equal(result.language, 'PHP');
  assert.ok(result.units.some(unit => unit.key === 'method:Controller.save'));
});

test('JavaScript detects worker construction inside a class', () => {
  const result = parseSource('class X { start() { return new Worker("./x.worker.js"); } }', 'src/X.js');
  assert.ok(result.units.some(unit => unit.key === 'method:X.start'));
  assert.ok(result.features.some(feature => feature.type === 'worker' && feature.target.includes('x.worker.js')));
});

test('JavaScript counts executable top-level statements as a structure', () => {
  const result = parseSource("const fs = require('node:fs');\nprocess.stdin.on('data', () => fs.readFileSync('x'));", 'hook.js');
  assert.ok(result.units.some(unit => unit.key === 'module:top-level'));
});

test('Vue extracts script declarations and static Tailwind classes', () => {
  const source = '<template><div class="p-4 text-red-500" /></template><script setup lang="ts">function ready(): boolean { return true }</script>';
  const result = parseSource(source, 'Panel.vue');
  assert.ok(result.units.some(unit => unit.key === 'setup:function:ready'));
  assert.deepEqual(result.features.find(feature => feature.type === 'tailwind-classes').values, ['p-4', 'text-red-500']);
});

test('CSS, PostgreSQL and Dockerfile have structural nodes', () => {
  assert.ok(parseSource('.btn { @apply p-4; color: red }', 'app.css').units.length);
  assert.ok(parseSource('CREATE TABLE users (id integer);', 'schema.sql').units.length);
  assert.ok(parseSource('FROM node:22\nRUN echo hi', 'Dockerfile').units.length === 2);
});

test('Python and Go extract declarations with their standard AST parsers', () => {
  const python = parseSource('class Client:\n    def run(self):\n        return ping()\n', 'client.py');
  assert.ok(python.units.some(unit => unit.key === 'method:Client.run' && unit.calls.includes('ping')));
  const go = parseSource('package sample\ntype Client struct{}\nfunc (c *Client) Run() { Ping() }\n', 'client.go');
  assert.ok(go.units.some(unit => unit.key === 'method:Client.Run' && unit.calls.includes('Ping')));
});
