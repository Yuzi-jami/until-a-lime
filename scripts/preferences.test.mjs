import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTheme,parseAutoLock,isDark,idleExpired} from '../src/preferences.ts';
test('existing themes remain intact and invalid settings use defaults',()=>{
 assert.equal(parseTheme('dark'),'dark');assert.equal(parseTheme('light'),'light');assert.equal(parseTheme('broken'),'system');
 assert.equal(parseAutoLock(null),5);assert.equal(parseAutoLock('NaN'),5);assert.equal(parseAutoLock('0'),0);
 assert.ok(isDark('system',true));assert.ok(!isDark('light',true));assert.ok(isDark('dark',false));
});
test('idle timeout checks boundaries, long suspension and backwards clocks',()=>{
 assert.ok(!idleExpired(1000,60999,1));assert.ok(idleExpired(1000,61000,1));
 assert.ok(idleExpired(1000,3600000,5));assert.ok(idleExpired(1000,0,5));
 assert.ok(!idleExpired(1000,3600000,0));
});
test('hour and custom idle durations persist and reject malformed preferences',()=>{
 for (const value of [30,60,90,120,240,480,1440]) assert.equal(parseAutoLock(String(value)),value);
 for (const value of ['-1','1.5','1441','Infinity','',' 60','1e2']) assert.equal(parseAutoLock(value),5);
 assert.equal(idleExpired(1000,1000+120*60000-1,120),false);
 assert.equal(idleExpired(1000,1000+120*60000,120),true);
});
