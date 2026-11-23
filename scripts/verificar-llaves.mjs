import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

// Software authenticator used only against a disposable localhost database.
const sha256 = data => createHash('sha256').update(data).digest();
const b64 = data => Buffer.from(data).toString('base64url');
function cborHead(type, value) {
  if (value < 24) return Buffer.from([type * 32 + value]);
  if (value < 256) return Buffer.from([type * 32 + 24, value]);
  const head = Buffer.alloc(3);
  head[0] = type * 32 + 25;
  head.writeUInt16BE(value, 1);
  return head;
}
function cbor(value) {
  if (Buffer.isBuffer(value)) return Buffer.concat([cborHead(2,value.length),value]);
  if (typeof value === 'string') {
    const data = Buffer.from(value);
    return Buffer.concat([cborHead(3,data.length),data]);
  }
  if (typeof value === 'number') return value < 0 ? cborHead(1,-1-value) : cborHead(0,value);
  return Buffer.concat([cborHead(5,value.size), ...Array.from(value,([key,entry])=>[cbor(key),cbor(entry)]).flat()]);
}

export async function verifyPasskeys({base,admin,session,challenge,password}) {
  const {publicKey,privateKey} = generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const coords = publicKey.export({format:'jwk'});
  const keyId = randomBytes(32);
  const credentialId = b64(keyId);
  const shape = {id:credentialId,rawId:credentialId,type:'public-key',clientExtensionResults:{}};
  const clientData = (type,options,origin=base.origin) => Buffer.from(JSON.stringify({
    type,challenge:options.challenge,origin,crossOrigin:false
  }));
  const registration = async () => (await (await admin('/api/auth/llaves/opciones',{method:'POST',body:{password}})).json());
  const attest = (ceremony,origin) => {
    const publicCose = cbor(new Map([[1,2],[3,-7],[-1,1],[-2,Buffer.from(coords.x,'base64url')],[-3,Buffer.from(coords.y,'base64url')]]));
    const properties = Buffer.alloc(23);
    properties[0] = 0x45;
    properties.writeUInt16BE(keyId.length,21);
    const authData = Buffer.concat([sha256(ceremony.options.rp.id),properties,keyId,publicCose]);
    const attestation = cbor(new Map([['fmt','none'],['attStmt',new Map()],['authData',authData]]));
    return {flow:ceremony.flow,name:'Llave virtual de prueba',credential:{...shape,response:{
      clientDataJSON:b64(clientData('webauthn.create',ceremony.options,origin)),attestationObject:b64(attestation),transports:['internal']
    }}};
  };

  const unrelated = await registration();
  await admin('/api/auth/llaves',{method:'POST',status:400,body:attest(unrelated,'http://127.0.0.1:'+base.port)});
  await admin('/api/auth/llaves',{method:'POST',status:409,body:attest(unrelated)});
  const create = await registration();
  const enrollment = attest(create);
  await admin('/api/auth/llaves',{method:'POST',status:204,body:enrollment});
  const {supported,keys} = await (await admin('/api/auth/llaves')).json();
  assert.equal(supported,true);
  assert.equal(keys[0].name,'Llave virtual de prueba');

  const another = session();
  assert.equal((await challenge(another,'admin')).hasPasskey,true);
  const options = await (await another('/api/auth/llaves/verificacion/opciones',{method:'POST'})).json();
  assert.ok(options.options.allowCredentials.some(x=>x.id===credentialId));
  const client = clientData('webauthn.get',options.options);
  const extra = Buffer.alloc(5);
  extra[0] = 0x05;
  extra.writeUInt32BE(1,1);
  const authData = Buffer.concat([sha256(options.options.rpId),extra]);
  const signed = sign('sha256',Buffer.concat([authData,sha256(client)]),privateKey);
  const assertion = {flow:options.flow,credential:{...shape,response:{
    clientDataJSON:b64(client),authenticatorData:b64(authData),signature:b64(signed),userHandle:create.options.user.id
  }}};
  const result = await (await another('/api/auth/llaves/verificacion',{method:'POST',body:assertion})).json();
  assert.equal(result.profile.role,'Administrador');
  await another('/api/auth/me');
  await another('/api/auth/llaves/verificacion',{method:'POST',status:400,body:assertion});
  await admin('/api/auth/llaves/'+keys[0].id,{method:'DELETE',status:204});
  console.log('Verificadas alta y autenticación WebAuthn con una llave de prueba, origen incorrecto y solicitud de un solo uso.');
}
