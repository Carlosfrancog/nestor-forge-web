'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const manifest = require('../package.json');

test('tree exposes script and agent actions without relying on the context menu', () => {
  const actions = manifest.contributes.menus['view/item/context'];
  const inline = (command, context) => actions.some(action => action.command === `agentOrchestra.${command}` &&
    action.group.startsWith('inline@') && action.when.includes(`viewItem == ${context}`));
  for (const command of ['runScriptQuick', 'runScript', 'instructions']) {
    assert.ok(inline(command, 'orchestraScript'), command);
  }
  for (const command of ['runAgent', 'dashboard', 'shareAgent']) {
    assert.ok(inline(command, 'orchestraAgent'), command);
  }
  assert.ok(inline('shareAgent', 'orchestraSkill'));
  assert.ok(inline('forgeBuild', 'orchestraSpec'));
  assert.ok(inline('agentRunInstructions', 'orchestraPreset'));
  assert.ok(!actions.some(action => action.command === 'agentOrchestra.runAgent' && action.when.includes('orchestraSkill')));
});

test('visible name is spaced and update/import actions use distinct icons', () => {
  const commands = Object.fromEntries(manifest.contributes.commands.map(item => [item.command, item]));
  assert.equal(manifest.displayName, 'Agent Orchestra (Nestor Forge)');
  assert.equal(manifest.contributes.viewsContainers.activitybar[0].title, 'Agent Orchestra');
  assert.notEqual(commands['agentOrchestra.checkUpdates'].icon, commands['agentOrchestra.importPackage'].icon);
  assert.equal(commands['agentOrchestra.checkUpdates'].icon, '$(versions)');
  const titleActions = manifest.contributes.menus['view/title'].filter(action => action.group.startsWith('navigation@'));
  assert.deepEqual(titleActions.map(action => action.command).sort(), [
    'agentOrchestra.checkUpdates', 'agentOrchestra.forgeCreate', 'agentOrchestra.projectMap'
  ]);
});
