import { roundDiscountCentsUp } from '../src/discountCalc.js';
import { roundTaxCentsEven } from '../src/taxCalc.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('discount rounding: non-tie rounds down', () => assert.equal(roundDiscountCentsUp(12.3), 12));
test('discount rounding: non-tie rounds up', () => assert.equal(roundDiscountCentsUp(12.7), 13));
test('discount rounding: exact tie rounds up', () => assert.equal(roundDiscountCentsUp(12.5), 13));
test('tax rounding: non-tie rounds down', () => assert.equal(roundTaxCentsEven(12.3), 12));
test('tax rounding: non-tie rounds up', () => assert.equal(roundTaxCentsEven(12.7), 13));
test('tax rounding: exact tie rounds to even (12.5 -> 12)', () => assert.equal(roundTaxCentsEven(12.5), 12));
test('tax rounding: exact tie rounds to even (13.5 -> 14)', () => assert.equal(roundTaxCentsEven(13.5), 14));
