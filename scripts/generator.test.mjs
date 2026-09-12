import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePassword, defaultGeneratorOptions, characterGroups } from '../src/generator.ts';

test('all nonempty group combinations meet length, coverage and alphabet rules',()=>{
 const keys=Object.keys(characterGroups);
 for(let mask=1;mask<16;mask++)for(const length of [8,20,64])for(const excludeAmbiguous of [true,false]){
   const options={...defaultGeneratorOptions,length,excludeAmbiguous,...Object.fromEntries(keys.map((key,index)=>[key,Boolean(mask&(1<<index))]))};
   const value=generatePassword(options);
   const groups=keys.filter(key=>options[key]).map(key=>excludeAmbiguous?characterGroups[key].replace(/[Il1O0o|]/g,''):characterGroups[key]);
   assert.equal(value.length,length);
   assert.ok([...value].every(char=>groups.join('').includes(char)));
   assert.ok(groups.every(group=>[...value].some(char=>group.includes(char))));
 }
});
test('invalid options fail before random generation',()=>{
 for(const length of [0,-1,7,65,8.5,NaN,Infinity])assert.throws(()=>generatePassword({...defaultGeneratorOptions,length}));
 assert.throws(()=>generatePassword({...defaultGeneratorOptions,uppercase:false,lowercase:false,digits:false,symbols:false}));
});
