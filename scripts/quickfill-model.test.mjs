import test from 'node:test';
import assert from 'node:assert/strict';
import { QuickfillRequest } from './quickfill-model.mjs';
const target = { processInstance: 'mock-start-1', windowToken: 'mock-window', focusToken: 'mock-field' };
function ready() { const r = new QuickfillRequest(); r.capture(target, 1, 0); r.select('password'); return r; }
test('valid single field consumes request once', () => { const r = ready(); assert.equal(r.verify(target, 1, 1, true), true); assert.equal(r.verify(target, 1, 2, true), false); });
for (const key of Object.keys(target)) test(`changed ${key} cancels`, () => assert.equal(ready().verify({...target, [key]: 'changed'}, 1, 1, true), false));
test('expiry, lock and unsupported privilege cancel', () => { assert.equal(ready().verify(target, 1, 5000, true), false); assert.equal(ready().verify(target, 2, 1, true), false); assert.equal(ready().verify(target, 1, 1, false), false); });
test('Escape cancellation is terminal', () => { const r = ready(); r.cancel(); assert.equal(r.verify(target, 1, 1, true), false); });
test('only explicit single fields allowed', () => { const r = new QuickfillRequest(); r.capture(target, 1, 0); assert.throws(() => r.select('user-tab-password')); });
