import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreEntry, restoreRecent } from '../src/entry-actions.ts';

test('undo restores deleted row without reverting later edits or additions',()=>{
 const deleted={entry:{id:2,name:'Deleted',favorite:true},index:1,recentIndex:1};
 const current=[{id:1,name:'Edited'},{id:3,name:'Added'}];
 const result=restoreEntry(current,deleted);
 assert.deepEqual(result.map(entry=>entry.id),[1,2,3]);
 assert.equal(result[0].name,'Edited');
 assert.equal(result[1].favorite,true);
 assert.equal(current.length,2);
 assert.equal(restoreEntry(result,deleted),result);
 assert.deepEqual(restoreRecent([3,1],deleted),[3,2,1]);
});
test('undo handles an empty collection and does not fabricate recent activity',()=>{
 const deleted={entry:{id:7},index:8,recentIndex:-1};
 assert.deepEqual(restoreEntry([],deleted),[deleted.entry]);
 assert.deepEqual(restoreRecent([],deleted),[]);
});
