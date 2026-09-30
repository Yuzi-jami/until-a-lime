import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { fillPage } from '../extension/fill.js';
function page(html = '<form><input autocomplete="username"><input type="password"></form>', url = 'https://example.invalid/login') {
  const dom = new JSDOM(html, { url, pretendToBeVisual:true, runScripts:'outside-only' });
  dom.window.HTMLInputElement.prototype.getClientRects = () => [{ width: 100, height:20 }];
  const fill = dom.window.eval(`(${fillPage.toString()})`);
  return { dom, fill, doc:dom.window.document };
}
const origin='https://example.invalid', credential={user:'fictional-user',password:'fictional-password'};
test('fills unique form once, emits input, never submits',()=>{
 const {dom,fill,doc}=page(); let submits=0,inputs=0;
 doc.addEventListener('submit',()=>submits++);doc.addEventListener('input',()=>inputs++);
 const p=fill('prepare',origin); assert.ok(p.ticket);
 assert.equal(fill('fill',origin,p.ticket,credential).filled,true);
 assert.equal(doc.querySelector('[type=password]').value,credential.password);
 assert.equal(inputs,2);assert.equal(submits,0);assert.ok(fill('fill',origin,p.ticket,credential).error);dom.window.close();
});
for (const [name,html] of [
 ['ambiguous','<input><input type="password"><input type="password">'],
 ['cross-origin action','<form action="https://evil.invalid"><input><input type="password"></form>'],
 ['new password','<form><input><input type="password" autocomplete="new-password"></form>']
]) test(name+' is rejected',()=>{const {dom,fill}=page(html);assert.ok(fill('prepare',origin).error);dom.window.close();});
test('HTTP, wrong origin, replacement fields, expiry and existing input cancel',()=>{
 for(const mutation of ['replace','expire','password','username']) {
  const {dom,fill,doc}=page();const p=fill('prepare',origin);
  if(mutation==='replace') doc.querySelector('[type=password]').outerHTML='<input type="password">';
  if(mutation==='expire') dom.window.__limeFillPlan.deadline=0;
  if(mutation==='password') doc.querySelector('[type=password]').value='already-entered';
  if(mutation==='username') doc.querySelector('input').value='different';
  assert.ok(fill('fill',origin,p.ticket,credential).error);dom.window.close();
 }
 const {dom,fill}=page(undefined,'http://example.invalid');assert.ok(fill('prepare',origin).error);dom.window.close();
 const other=page();assert.ok(other.fill('prepare','https://other.invalid').error);other.dom.window.close();
});

test('xcpcai-style controlled form keeps both fields after username rerender',()=>{
 const {dom,fill,doc}=page('<form><input name="username" placeholder="Enter your username or email"><input name="password" type="password" placeholder="Enter password"><button type="button">Toggle password visibility</button></form>');
 const username=doc.querySelector('[name=username]'),password=doc.querySelector('[name=password]');
 // Models a controlled render restoring the not-yet-updated password state.
 username.addEventListener('input',()=>{password.value='';});
 const p=fill('prepare',origin);assert.ok(p.ticket);
 assert.equal(fill('fill',origin,p.ticket,credential).filled,true);
 assert.equal(username.value,credential.user);assert.equal(password.value,credential.password);dom.window.close();
});
test('username handler replacing password cancels before disclosing password',()=>{
 const {dom,fill,doc}=page();
 doc.querySelector('input').addEventListener('input',()=>{doc.querySelector('[type=password]').outerHTML='<input type="password">';});
 const p=fill('prepare',origin);assert.ok(fill('fill',origin,p.ticket,credential).error);
 assert.equal(doc.querySelector('[type=password]').value,'');dom.window.close();
});
test('phone login with captcha and search inputs selects the login account field',()=>{
 const {dom,fill,doc}=page('<input type="search" placeholder="搜索"><form><input id="phone" placeholder="手机号/超星号"><input type="password" placeholder="学习通密码"><input name="captcha" placeholder="验证码"><button>登录</button></form>','https://v1.chaoxing.com/backSchool/toLogin');
 const site='https://v1.chaoxing.com';
 const plan=fill('prepare',site); assert.ok(plan.ticket);
 assert.ok(fill('fill',site,plan.ticket,credential).filled);
 assert.equal(doc.querySelector('#phone').value,credential.user);
 assert.equal(doc.querySelector('[name=captcha]').value,''); dom.window.close();
});
