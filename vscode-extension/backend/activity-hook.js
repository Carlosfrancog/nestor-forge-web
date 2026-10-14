'use strict';

const fs = require('node:fs');
const path = require('node:path');

const [logFile, platform] = process.argv.slice(2);
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { if (input.length < 2_000_000) input += chunk; });
process.stdin.on('end', () => {
  try {
    const event = JSON.parse(input);
    if (['SubagentStart', 'SubagentStop'].includes(event.hook_event_name) && event.agent_type && logFile) {
      const record = {
        at: new Date().toISOString(), platform, event: event.hook_event_name,
        cwd: event.cwd || '', session: event.session_id || '',
        agentId: event.agent_id || '', agentType: event.agent_type
      };
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      fs.appendFileSync(logFile, JSON.stringify(record) + '\n', 'utf8');
    }
  } catch (_) {
    // Falhas de observação não interferem na execução do agente.
  }
  process.stdout.write('{}\n');
});
