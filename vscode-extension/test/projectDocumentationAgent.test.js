'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { documentationPrompt } = require('../src/projectDocumentationAgent');

test('documentation task directs the agent to verify Laravel domains and read contextual notes', () => {
  const prompt = documentationPrompt({ handoff: '.agentorchestra/context/project-handoff.json', docs: 'docs/architecture', framework: 'Laravel' });
  assert.match(prompt, /app\/Http.*camadas técnicas/);
  assert.match(prompt, /docs\/architecture\/guides\/README\.md/);
  assert.match(prompt, /graphify-out\/vault-modules\/CONTEXTO/);
  assert.match(prompt, /project-handoff\.json/);
});
