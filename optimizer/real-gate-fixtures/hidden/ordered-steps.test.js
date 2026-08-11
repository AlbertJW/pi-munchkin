import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoster } from '../src/roster.js';

test('falls back to the submitted address when no name was typed', () => {
  const rows = buildRoster([
    { id: 'm1', email: 'Ada_Lovelace@Example.COM' },
  ]);
  assert.deepStrictEqual(rows, [
    { id: 'm1', email: 'a***@example.com', name: 'Ada Lovelace' },
  ]);
});

test('treats a blank name as no name', () => {
  const rows = buildRoster([
    { id: 'm2', email: '  grace.hopper@mail.example.org  ', name: '   ' },
  ]);
  assert.deepStrictEqual(rows, [
    { id: 'm2', email: 'g***@mail.example.org', name: 'Grace Hopper' },
  ]);
});

test('splits on all three separators and capitalises each piece', () => {
  const rows = buildRoster([
    { id: 'm3', email: 'jean-bartik@example.com' },
    { id: 'm4', email: 'KAY.MCNULTY@example.com', name: '' },
  ]);
  assert.deepStrictEqual(rows, [
    { id: 'm3', email: 'j***@example.com', name: 'Jean Bartik' },
    { id: 'm4', email: 'k***@example.com', name: 'Kay Mcnulty' },
  ]);
});

test('mixes supplied and derived names in one batch', () => {
  const rows = buildRoster([
    { id: 'm5', email: 'alan.turing@example.com', name: ' Alan T ' },
    { id: 'm6', email: 'betty_snyder@example.com' },
  ]);
  assert.deepStrictEqual(rows, [
    { id: 'm5', email: 'a***@example.com', name: 'Alan T' },
    { id: 'm6', email: 'b***@example.com', name: 'Betty Snyder' },
  ]);
});
