import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const base = new URL(process.argv[2] ?? 'http://localhost:5099');
const outbox = process.env.RecoveryMail__PickupDirectory;
assert.ok(outbox && process.env.BUMI_TEST_ENROLL === '1', 'Usa una base y un buzón de pruebas desechables.');
const original = process.env.DemoPassword;
const changed = 'Recuperacion-BUMI-prueba-34!';
const email = 'compras@nexo.test';

function client() {
  const cookies = new Map();
  return async (url, {method='GET', body} = {}) => {
    const headers = {cookie: [...cookies].map(([key,value])=>key+'='+value).join('; ')};
    if (method !== 'GET') {
      headers['X-Nexo-Request'] = '1';
      headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(new URL(url,base), {method,headers,body:body ? JSON.stringify(body) : undefined});
    for (const cookie of response.headers.getSetCookie()) {
      const [name,value] = cookie.split(';',1)[0].split('=');
      if (value) cookies.set(name,value);
      else cookies.delete(name);
    }
    return response;
  };
}
const post = (request, path, body) => request(path,{method:'POST',body});
const active = client();
const other = client();
const login = (agent,password) => post(agent,'/api/auth/login',{email,password});
assert.equal((await active('/recuperar')).status,200);
assert.equal((await active('/recuperar-con-codigos')).status,200);
const page = await active('/restablecer');
assert.equal(page.status,200);
assert.equal(page.headers.get('referrer-policy'),'no-referrer');
const start = await login(active,original);
assert.equal(start.status,200);
const pending = await start.json();
const key = pending.setup.key;
function totp(key, offset = 0) {
  let bits = '';
  for (const char of key) bits += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char).toString(2).padStart(5,'0');
  const secret = Buffer.from(bits.match(/.{8}/g).map(value=>parseInt(value,2)));
  const counter = Buffer.alloc(8);
  counter.writeBigInt64BE(BigInt(Math.floor(Date.now()/30000) + offset));
  const hash = createHmac('sha1',secret).update(counter).digest();
  return String((hash.readUInt32BE(hash.at(-1)&15)&0x7fffffff)%1_000_000).padStart(6,'0');
}
const passcode = totp(key);
const verify = (agent,code,useRecovery=false) => post(agent,'/api/auth/verify',{code,useRecovery});
const enrolled = await verify(active,passcode);
assert.equal(enrolled.status,200);
const codes = (await enrolled.json()).recoveryCodes;
assert.ok(codes.length > 0);
assert.equal((await active('/api/auth/me')).status,200);
assert.equal((await post(active,'/api/auth/authenticator/reset',{password:original})).status,204);
const replacement = await (await active('/api/auth/challenge')).json();
assert.equal(replacement.replacement,true);
assert.notEqual(replacement.setup.key,key);
assert.equal((await active('/api/auth/challenge',{method:'DELETE'})).status,204);
assert.equal((await active('/api/auth/challenge')).status,204);
assert.equal((await (await login(active,original)).json()).setup,null);
assert.equal((await verify(active,codes[0],true)).status,200);
const isolated = client();
assert.equal((await login(isolated,original)).status,200);
assert.equal((await verify(isolated,codes.at(-1),true)).status,200);
assert.equal((await active('/api/auth/sesiones',{method:'GET'})).status,200);
assert.equal((await active('/api/auth/sesiones/otras',{method:'DELETE'})).status,204);
assert.equal((await active('/api/auth/me')).status,200);
assert.equal((await isolated('/api/auth/me')).status,401);
console.log('Cierre de sesiones remotas verificado sin cerrar la sesión actual.');
const phoneState = async () => (await active('/api/auth/authenticator/phones')).json();
assert.deepEqual(await phoneState(), {linked:true,additional:false});
assert.equal((await post(active,'/api/auth/authenticator/reset',{password:original,addPhone:true})).status,204);
const addition = await (await active('/api/auth/challenge')).json();
assert.equal(addition.addPhone,true);
assert.notEqual(addition.setup.key,key);
const phoneEnrollment = await verify(active,totp(addition.setup.key,-1));
assert.equal(phoneEnrollment.status,200);
assert.equal((await phoneEnrollment.json()).recoveryCodes,null);
assert.deepEqual(await phoneState(), {linked:true,additional:true});
const secondPhone = client();
assert.equal((await login(secondPhone,original)).status,200);
assert.equal((await verify(secondPhone,totp(addition.setup.key))).status,200);
const mainPhone = client();
assert.equal((await login(mainPhone,original)).status,200);
assert.equal((await verify(mainPhone,totp(key,1))).status,200);
assert.equal((await post(active,'/api/auth/authenticator/phones/remove',{password:original})).status,204);
assert.equal((await secondPhone('/api/auth/me')).status,401);
assert.equal((await mainPhone('/api/auth/me')).status,401);
assert.equal((await login(active,original)).status,200);
assert.equal((await verify(active,codes[4],true)).status,200);
assert.deepEqual(await phoneState(), {linked:true,additional:false});
console.log('Segundo teléfono verificado con códigos independientes y retiro de acceso.');

async function readMailbox(expected) {
  let files = [];
  for (let i=0;i<50 && files.length<expected;i++) {
    files = await readdir(outbox).catch(()=>[]);
    if (files.length<expected) await delay(100);
  }
  await delay(250);
  assert.equal(files.length,expected);
  return Promise.all(files.map(async file=>{
    const eml = await readFile(join(outbox,file),'utf8');
    const parts = eml.replace(/\r\n/g,'\n').split('\n\n');
    const headers = parts.shift();
    let text = parts.join('\n\n');
    if (/content-transfer-encoding:\s*base64/i.test(headers)) text = Buffer.from(text,'base64').toString('utf8');
    if (/content-transfer-encoding:\s*quoted-printable/i.test(headers))
      text = text.replace(/=\n/g,'').replace(/=([\da-f]{2})/ig,(_,hex)=>String.fromCharCode(parseInt(hex,16)));
    return {headers,text};
  }));
}
const alt = 'buzon-alterno@correo.test';
assert.equal((await other('/api/auth/recovery/mailbox')).status,401);
assert.equal((await post(active,'/api/auth/recovery/mailbox',{email:alt,password:'incorrecta'})).status,400);
assert.equal((await post(active,'/api/auth/recovery/mailbox',{email:alt,password:original})).status,204);
assert.equal((await (await active('/api/auth/recovery/mailbox')).json()).pending,alt);
const [validation] = await readMailbox(1);
assert.match(validation.headers,/^To: buzon-alterno@correo\.test$/mi);
const mailboxCode = validation.text.match(/^[\dA-F]{12}$/m)?.[0];
assert.ok(mailboxCode);
assert.equal((await post(active,'/api/auth/recovery/mailbox/confirm',{code:'A'.repeat(12)})).status,400);
assert.equal((await post(active,'/api/auth/recovery/mailbox/confirm',{code:mailboxCode})).status,204);
assert.equal((await post(active,'/api/auth/recovery/mailbox/confirm',{code:mailboxCode})).status,400);
assert.deepEqual((await (await active('/api/auth/recovery/mailbox')).json()).emails,[alt]);

const ask = (email,recipient) => post(other,'/api/auth/recovery/email',{email,recipient});
assert.equal((await ask(email,'no-verificado@outlook.test')).status,202);
assert.equal((await ask(email,alt)).status,202);
assert.equal((await ask(email,alt)).status,202);
const mail = (await readMailbox(2)).find(item=>item.text.includes('/restablecer#'));
assert.ok(mail);
assert.match(mail.headers,/^To: buzon-alterno@correo\.test$/mi);
const text = mail.text;
const url = text.match(/https?:\/\/[^\s]+\/restablecer#token=[\w-]{43}/)?.[0];
assert.ok(url,'El correo incluye el enlace de recuperación.');
assert.equal(new URL(url).origin,base.origin);
const token = new URLSearchParams(new URL(url).hash.slice(1)).get('token');
const reset = (value, agent=other) => post(agent,'/api/auth/recovery/reset',{token:value,password:changed});
assert.equal((await reset('A'.repeat(43))).status,400);
const emailCode = text.match(/^[\dA-F]{12}$/m)?.[0];
assert.ok(emailCode);
const resetByCode = (email, code) => post(client(),'/api/auth/recovery/reset',{email,code,password:changed});
assert.equal((await resetByCode('cuenta-distinta@bumi.test',emailCode)).status,400);
const attempts = await Promise.all([resetByCode(email,emailCode),resetByCode(email,emailCode)]);
assert.deepEqual(attempts.map(response=>response.status).sort(),[204,400]);
assert.equal((await active('/api/auth/me')).status,401);
assert.equal((await login(other,original)).status,401);
assert.equal((await login(other,changed)).status,200);
assert.equal((await other('/api/auth/me')).status,401);
assert.equal((await verify(other,codes[1],true)).status,200);
assert.equal((await reset(token)).status,400);
assert.equal((await post(other,'/api/auth/recovery/mailbox/quitar',{email:alt,password:changed})).status,204);
assert.deepEqual((await (await other('/api/auth/recovery/mailbox')).json()).emails,[]);
assert.equal((await resetByCode(email,emailCode)).status,400);
const recoverWithBackup = (recoveryCode, password) =>
  post(client(),'/api/auth/recovery/backup',{recoveryCode,password});
assert.equal((await recoverWithBackup(codes[1])).status,400);
assert.equal((await recoverWithBackup(codes[2].replaceAll('-','').toLowerCase())).status,204);
assert.equal((await recoverWithBackup(codes[2])).status,204);
assert.equal((await recoverWithBackup(codes[2],'corta')).status,400);
const backupResets = await Promise.all([recoverWithBackup(codes[2], original), recoverWithBackup(codes[2], original)]);
assert.deepEqual(backupResets.map(response=>response.status).sort(),[204,400]);
assert.equal((await recoverWithBackup(codes[2])).status,400);
assert.equal((await other('/api/auth/me')).status,401);
assert.equal((await login(other,changed)).status,401);
assert.equal((await login(other,original)).status,200);
assert.equal((await other('/api/auth/me')).status,401);
assert.equal((await verify(other,codes[3],true)).status,200);
console.log('Recuperación con un solo código de respaldo verificada, incluido el consumo concurrente.');
console.log('Cancelación de reemplazo de teléfono y recuperación SMTP verificadas en buzón local: respuesta neutra, límite por cuenta, enlace de un solo uso, cambio de contraseña, revocación de sesión y segundo factor con respaldo.');

