import assert from 'node:assert/strict';
import test from 'node:test';
// Deployment is operator tooling, not a runtime extension.
// @ts-ignore JavaScript operator tooling has no public declaration surface.
import { assertNoPiWriters, destinations } from '../scripts/deploy-goal-repair.mjs';

test('repair deployment rejects missing process inventory and every supported Pi launch form', () => {
  for (const output of ['', 'inspection failed', '12 pi pi -p hello',
    '12 node node /opt/homebrew/bin/pi',
    '12 node node /opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js',
    '12 node node /opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/rpc-entry.js']) {
    assert.throws(() => assertNoPiWriters(output), /inspection|stop Pi/);
  }
  assert.doesNotThrow(() => assertNoPiWriters('1 /sbin/launchd /sbin/launchd\n12 node node qualify-goal-repair.mjs'));
});

test('repair deployment destinations are limited to three code files', () => {
  assert.deepEqual(destinations, ['extensions/pi-munchkin/lib/goal-state.ts',
    'extensions/pi-munchkin/extensions/plan-runner.ts', 'extensions/pi-munchkin/lib/private-state-lock.ts']);
  assert.equal(Object.isFrozen(destinations), true);
});
