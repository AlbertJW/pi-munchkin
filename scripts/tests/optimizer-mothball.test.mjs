import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const manifest = JSON.parse(readFileSync('optimizer/MOTHBALLED.json', 'utf8'));
assert.equal(manifest.status, 'mothballed');
for (const path of [...manifest.python_cli, ...manifest.shell_cli]) {
  test(`archived entrypoint refuses execution: ${path}`, () => {
    // Check the barrier before invoking any archived code, even with --help.
    const source = readFileSync(path, 'utf8');
    assert.match(source, /Optimizer mothballed/);
    const command = path.endsWith('.py') ? 'python3' : 'bash';
    const result = spawnSync(command, [path, '--help'], {
      encoding: 'utf8', timeout: 10000,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    });
    assert.equal(result.status, 78, result.stderr || result.stdout);
    assert.match(result.stderr, /Optimizer mothballed/);
  });
}
for (const args of [['-m', 'optimizer.v2.cli', '--help'], ['-c', 'import optimizer.v2.engine']]) {
  test(`V2 cannot be restarted through module/import entry: ${args.join(' ')}`, () => {
    const result = spawnSync('python3', args, { encoding: 'utf8', timeout: 10000,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
    assert.equal(result.status, 78, result.stderr || result.stdout);
    assert.match(result.stderr, /Optimizer mothballed/);
  });
}
test('retained config validator works offline', () => {
  const result = spawnSync('python3', ['optimizer/prompt-lab/config.py', '--selftest'], {
    encoding: 'utf8', timeout: 10000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
