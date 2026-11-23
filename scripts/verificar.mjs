import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { verifyPasskeys } from './verificar-llaves.mjs';

const base = new URL(process.argv[2] || 'http://127.0.0.1:5088');
const password = process.env.DEMO_PASSWORD || 'NexoDemo-2026!';
const disposable = process.env.BUMI_TEST_ENROLL === '1';
const verifyImprovements = disposable && process.env.BUMI_TEST_IMPROVEMENTS === '1';

function session() {
  const jar = new Map();
  return async (path, { method = 'GET', body, status = 200 } = {}) => {
    const headers = {};
    if (jar.size) headers.cookie = Array.from(jar, ([name, value]) => name + '=' + value).join('; ');
    if (method !== 'GET') {
      headers['X-Nexo-Request'] = '1';
      headers.origin = base.origin;
    }
    if (body) headers['Content-Type'] = 'application/json';
    const send = () => fetch(new URL(path, base), {
      method, headers, body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8_000),
    });
    let response = await send();
    if (verifyImprovements && response.status === 429 && status !== 429 && path.startsWith('/api/auth/')) {
      // The combined suite shares the intentional production rate limit on its one loopback address.
      await delay(60_100);
      response = await send();
    }
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';', 1)[0];
      const separator = pair.indexOf('=');
      const value = pair.slice(separator + 1);
      if (value) jar.set(pair.slice(0, separator), value);
      else jar.delete(pair.slice(0, separator));
    }
    assert.equal(response.status, status, method + ' ' + path);
    return response;
  };
}

function totp(key, offset = 0) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let mask = 0, bits = 0;
  const bytes = [];
  for (const char of key) {
    const digit = alphabet.indexOf(char);
    assert.ok(digit >= 0);
    mask = (mask << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((mask >> bits) & 255);
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offset));
  const hash = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  return String((hash.readUInt32BE(hash.at(-1) & 15) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

const request = session();
assert.equal((await (await request('/api/health')).json()).database, 'PostgreSQL');
await request('/api/clientes', {status: 401});
const view = await (await request('/cotizaciones')).text();
assert.match(view, /<title>BUMI<\/title>/);
assert.match(view, /rel="manifest"/);
const manifestResponse = await request('/manifest.webmanifest');
assert.match(manifestResponse.headers.get('content-type'), /application\/manifest\+json/);
const manifest = await manifestResponse.json();
assert.equal(manifest.name, 'BUMI');
assert.equal(manifest.display, 'standalone');
for (const icon of manifest.icons) {
  assert.equal((await request(icon.src)).headers.get('content-type'), 'image/png');
}
assert.match(await (await request('/sin-conexion.html')).text(), /<h1>Sin conexión<\/h1>/);
await request('/sw.js');
console.log('Verificados PostgreSQL, rutas web y recursos de instalación móvil.');

async function challenge(client, name, secret = password, status = 200) {
  const response = await client('/api/auth/login', {
    method: 'POST', body: {email: name + '@nexo.test', password: secret}, status
  });
  return status === 200 ? response.json() : null;
}
const verify = (client, code, useRecovery = false, status = 200) =>
  client('/api/auth/verify', {method: 'POST', body: {code, useRecovery}, status});
const logout = client => client('/api/auth/logout', {method: 'POST', status: 204});

if (disposable) {
  const roles = [
    ['admin', 'Administrador'], ['gerencia', 'Gerente'], ['ventas', 'Vendedor'], ['marketing', 'Marketing']
  ];
  const team = [];
  for (const [name, role] of roles) {
    let client = session();
    let pending = await challenge(client, name);
    await client('/api/auth/me', {status: 401});
    assert.ok(pending.setup?.key, 'Usa una base desechable recién creada para esta prueba.');
    assert.equal(Buffer.from(pending.setup.qr, 'base64').subarray(1, 4).toString(), 'PNG');
    if (name === 'admin') {
      const original = pending.setup.key;
      const resumed = await (await client('/api/auth/challenge')).json();
      assert.equal(resumed.setup.key, original);
      const previous = client;
      client = session();
      pending = await challenge(client, name);
      assert.equal(pending.setup.key, original);
      const updated = await client('/api/auth/challenge/rotate', {method: 'POST'});
      pending = await updated.json();
      assert.notEqual(pending.setup.key, original);
      await verify(previous, totp(original), false, 410);
    }
    const code = totp(pending.setup.key);
    if (name === 'admin') await verify(client, code === '111111' ? '222222' : '111111', false, 400);
    const outcome = await (await verify(client, code)).json();
    assert.equal(outcome.profile.role, role);
    assert.equal(outcome.recoveryCodes.length, 8);
    team.push({client, name, key: pending.setup.key, code, backup: outcome.recoveryCodes});
  }
  const [{client: admin}, manager, seller, marketer] = team;
  const campaignList = await (await marketer.client('/api/marketing')).json();
  assert.ok(campaignList.length && Array.isArray(campaignList[0].audience));
  await seller.client('/api/marketing', {status: 403});
  const readDashboard = async (client, days) => (await client('/api/inicio/panel?days=' + days)).json();
  const marketingDashboard = await readDashboard(marketer.client, 90);
  assert.equal(marketingDashboard.salesTotal, null);
  assert.equal(marketingDashboard.activeQuotes, null);
  assert.equal(marketingDashboard.newClients, null);
  assert.equal(marketingDashboard.analyst, null);
  assert.deepEqual(marketingDashboard.operations, []);
  const names = await (await admin('/api/config/accounts')).json();
  assert.ok(names.find(account => account.current)?.lastSession);
  const permissions = await (await admin('/api/config/permisos')).json();
  assert.ok(permissions.modules.cotizaciones.includes('Vendedor'));
  assert.ok(!permissions.modules.ventas.includes('Marketing'));
  assert.deepEqual(await (await manager.client('/api/config/permisos')).json(), permissions);
  assert.ok((await (await manager.client('/api/config/accounts')).json()).some(account => account.current && account.role === 'Gerente'));
  await manager.client('/api/config/marketing', {method:'PUT', body:{enabled:false},status:403});
  await seller.client('/api/config/permisos', {status: 403});
  await marketer.client('/api/config/accounts', {status:403});
  const ownAccount = names.find(account => account.current);
  await admin('/api/config/accounts/' + ownAccount.id, {method:'DELETE',status:400});
  await manager.client('/api/config/accounts/' + ownAccount.id, {method:'DELETE',status:403});
  assert.ok(!permissions.writers.inventario.includes('Vendedor'));
  assert.ok(permissions.writers.inventario.includes('Inventario'));
  const editRole = (client, id, role, status) => client('/api/config/accounts/' + id + '/rol', {method:'PUT', body:{role}, status});
  await editRole(admin, names.find(account => account.current).id, 'Gerente', 400);
  const targetForRole = names.find(account => account.role === 'Compras');
  await editRole(seller.client, targetForRole.id, 'Inventario', 403);
  await editRole(manager.client, targetForRole.id, 'Inventario', 403);
  await editRole(admin, targetForRole.id, 'Inventario', 204);
  assert.equal((await (await admin('/api/config/accounts')).json()).find(account => account.id === targetForRole.id).role, 'Inventario');
  await editRole(admin, targetForRole.id, 'Compras', 204);
  await request('/api/buscar?q=Monitor', {status: 401});
  const marketerId = names.find(account => account.role === 'Marketing').id;
  await admin('/api/config/accounts/' + marketerId, {method: 'PUT', body: {active: false}, status: 204});
  await marketer.client('/api/auth/me', {status: 401});
  await challenge(marketer.client, marketer.name, password, 401);
  await admin('/api/config/accounts/' + marketerId, {method: 'PUT', body: {active: true}, status: 204});

  const owners = await (await admin('/api/clientes/responsables')).json();
  const owner = owners.find(item => item.id === names.find(account => account.role === 'Vendedor').id);
  const party = await (await admin('/api/clientes', {method: 'POST', body: {
    kind: 'Cliente', name: 'Cliente para verificar BUMI ' + Date.now(), personType: 'Empresa',
    stage: 'Nuevo', ownerId: owner.id
  }})).json();
  const visible = await (await seller.client('/api/clientes')).json();
  assert.ok(visible.some(item => item.id === party.id));
  const find = async (client, term) => (await client('/api/buscar?q=' + encodeURIComponent(term))).json();
  assert.ok((await find(seller.client, party.name)).some(hit => hit.module === 'clientes' && hit.id === party.id));
  assert.deepEqual(await find(manager.client, '%_'), []);
  assert.deepEqual(await find(seller.client, 'a'), []);

  const task = await (await admin('/api/agenda', {method:'POST', body:{
    title:'Revisar propuesta de prueba', type:'Seguimiento', status:'Pendiente',
    due:new Date(Date.now() + 3600000).toISOString(), ownerId:owner.id, partyId:party.id
  }})).json();
  const taskRow = (await (await seller.client('/api/agenda')).json()).find(item => item.id === task.id);
  assert.equal(taskRow.partyId, party.id);
  const notice = (await (await seller.client('/api/notificaciones')).json()).find(item => item.route === '/agenda' && item.recordId === task.id);
  assert.equal(notice.read,false);
  await seller.client('/api/notificaciones/' + encodeURIComponent(notice.key) + '/leida',{method:'PUT',status:204});
  assert.ok((await (await seller.client('/api/notificaciones')).json()).some(item => item.key === notice.key && item.read));
  await seller.client('/api/agenda/' + task.id,{method:'PUT',body:{...taskRow,status:'Completada'}});
  await seller.client('/api/historial/comentarios',{method:'POST',status:204,
    body:{partyId:party.id,type:'Llamada',text:'Se confirmó la reunión.'}});
  const history = await (await seller.client('/api/historial?ficha=' + party.id)).json();
  assert.ok(history.some(item => item.type === 'Llamada'));
  assert.ok(history.some(item => item.type === 'Agenda' && item.description.includes('Completada')));
  const home = await (await seller.client('/api/inicio')).json();
  assert.ok(Array.isArray(home.tasks) && Array.isArray(home.recent));
  await request('/api/inicio/panel', {status: 401});
  await admin('/api/inicio/panel?days=7', {status: 400});
  const dashboard = await readDashboard(admin, 30);
  assert.equal(dashboard.series.length, 6);
  assert.equal(dashboard.series[0].from, dashboard.start);
  assert.equal(dashboard.series.at(-1).through, dashboard.end);
  assert.ok(Math.abs(dashboard.series.reduce((total, point) => total + point.total, 0) - dashboard.salesTotal) < .001);
  assert.ok(dashboard.operations.every(item => item.date >= dashboard.start && item.date <= dashboard.end));
  const sellerDashboard = await readDashboard(seller.client, 365);
  assert.ok(sellerDashboard.operations.length > 0);
  assert.ok(sellerDashboard.operations.every(item => item.owner === owner.name));
  assert.ok(sellerDashboard.newClients >= 1);
  assert.ok(sellerDashboard.analyst.openCount > 0);
  assert.ok(sellerDashboard.analyst.suggestions.every(item =>
    !['Ganada', 'Perdida'].includes(item.stage) && item.recommendation.length > 0));
  assert.deepEqual((await (await seller.client('/api/inicio?includeNotices=false')).json()).notices, []);
  console.log('Panel de Inicio verificado en tres periodos y con permisos por rol.');

  const catalogInput = {sku:'TEST-' + Date.now(),name:'Producto de verificación',category:'Prueba',unit:'Pieza',price:100,minimum:3,active:true};
  await seller.client('/api/inventario',{method:'POST',body:catalogInput,status:403});
  const catalogItem = await (await admin('/api/inventario',{method:'POST',body:catalogInput})).json();
  await admin('/api/inventario/' + catalogItem.id + '/movimientos',{method:'POST',
    body:{type:'Entrada',quantity:10,reason:'Recepción para prueba'}});
  const supplier = await (await admin('/api/proveedores',{method:'POST',
    body:{name:'Proveedor para verificación',active:true,productIds:[catalogItem.id]}})).json();
  const listed = (await (await admin('/api/proveedores')).json()).find(item => item.id === supplier.id);
  assert.ok(listed.products.some(item => item.id === catalogItem.id));
  await seller.client('/api/proveedores',{status:403});

  const projection = await (await admin('/api/marketing/pronostico?canal=Eventos&contactos=100')).json();
  assert.equal(projection.available,true);
  assert.ok(projection.expected >= projection.low && projection.expected <= projection.high);
  assert.deepEqual(projection.projections.map(item => item.channel), ['Eventos']);
  assert.equal(projection.projections[0].estimate.expected, projection.expected);
  assert.equal(projection.projections[0].estimate.low, projection.low);
  const allChannels = await (await admin('/api/marketing/pronostico?contactos=250')).json();
  assert.ok(allChannels.projections.every(({estimate}) => estimate.low <= estimate.expected &&
    estimate.expected <= estimate.high && estimate.high <= 250));
  assert.equal((await (await admin('/api/marketing/pronostico?canal=CanalSinDatos&contactos=100')).json()).available,false);
  const quoteCount = (await (await admin('/api/cotizaciones')).json()).length;
  const saleInput = {partyId: party.id, taxRate: 16, reason: 'Venta de prueba de la API',
    lines: [{productId:catalogItem.id, product: 'Papel', quantity: 2, price: 100, discount: 10}]};
  await manager.client('/api/ventas/directa', {method:'POST',status:409,
    body:{...saleInput,lines:[{...saleInput.lines[0],quantity:11}]}});
  await seller.client('/api/ventas/directa', {method: 'POST', body: saleInput, status: 403});
  const sale = await (await manager.client('/api/ventas/directa', {method: 'POST', body: saleInput})).json();
  const saleRow = (await (await admin('/api/ventas')).json()).find(item => item.id === sale.id);
  assert.equal(saleRow.total, 208.8);
  assert.equal(saleRow.quoteId, null);
  const saleFolio = 'VTA-' + String(sale.id).padStart(4, '0');
  assert.ok((await find(admin, saleFolio)).some(hit => hit.module === 'ventas' && hit.id === sale.id));
  assert.deepEqual(await find(seller.client, saleFolio), []);
  console.log('Búsqueda global por nombre y folio y matriz de permisos verificadas.');
  const inventory = async () => (await (await admin('/api/inventario')).json()).find(item => item.id === catalogItem.id);
  assert.equal((await inventory()).stock,8);
  assert.equal((await (await admin('/api/cotizaciones')).json()).length, quoteCount);
  await manager.client('/api/ventas/' + sale.id + '/estado', { method: 'PATCH',
    body: {status: 'Cancelada', reason: 'Fin de la prueba'}, status: 204 });
  const events = await (await admin('/api/ventas/' + sale.id + '/historial')).json();
  assert.equal(events.length, 2);
  assert.equal((await inventory()).stock,10);
  await manager.client('/api/ventas/' + sale.id + '/estado',{method:'PATCH',status:400,
    body:{status:'Cancelada',reason:'Intento duplicado'}});
  assert.equal((await inventory()).stock,10);
  assert.equal(events[0].description, 'Fin de la prueba');
  assert.ok(events[1].description.includes(saleInput.reason));
  const statistics = await (await admin('/api/estadisticas')).json();
  assert.ok(Array.isArray(statistics.months) && Number.isFinite(statistics.revenue));
  assert.equal(statistics.months.reduce((total, month) => total + month.count, 0), statistics.salesCount);
  assert.ok(Math.abs(statistics.months.reduce((total, month) => total + month.total, 0) - statistics.revenue) < 0.01);
  const cancelledStats = await (await admin('/api/estadisticas?estado=Cancelada')).json();
  assert.equal(cancelledStats.forecast.forecast.length, 0);
  const shortStats = await (await admin('/api/estadisticas?desde=' + statistics.end)).json();
  assert.equal(shortStats.forecast.forecast.length, 0);
  if (/^(1|true)$/i.test(process.env.BUMI_TEST_DEMO ?? '')) {
    assert.ok(statistics.forecast.months >= 12 && statistics.forecast.model);
    assert.equal(statistics.forecast.forecast.length, 3);
    assert.ok(statistics.forecast.forecast.every(point => point.low <= point.estimate && point.estimate <= point.high));
    assert.ok(statistics.forecast.meanError >= 0);
    assert.ok(statistics.salesCount > 70);
    const stock = await (await admin('/api/inventario')).json();
    const sample = stock.filter(product => product.sku.startsWith('AUR-'));
    assert.equal(sample.length, 12);
    assert.equal(sample.filter(product => product.stock < product.minimum).length, 3);
    const sellerStats = await (await seller.client('/api/estadisticas?responsable=' + marketerId)).json();
    const sellerScoped = await (await admin('/api/estadisticas?responsable=' + owner.id)).json();
    assert.equal(sellerStats.revenue, sellerScoped.revenue);
    assert.deepEqual(sellerStats.forecast, sellerScoped.forecast);
  }

  const lead = await (await seller.client('/api/clientes', {method: 'POST', body: {
    kind: 'Prospecto', name: 'Prospecto de prueba comercial', personType: 'Empresa',
    stage: 'Nuevo', source: 'Evento'
  }})).json();
  const opportunity = await (await seller.client('/api/clientes/' + lead.id + '/oportunidades',{method:'POST',
    body:{description:'Renovación de equipo',stage:'Nueva',value:2000}})).json();
  await seller.client('/api/clientes/oportunidades/' + opportunity.id + '/etapa',{method:'PATCH',status:204,body:{stage:'Propuesta'}});
  const board = await (await seller.client('/api/clientes/oportunidades/tablero')).json();
  assert.ok(board.some(item => item.id === opportunity.id && item.stage === 'Propuesta'));
  const directory = await (await seller.client('/api/clientes/directorio')).json();
  const leadSummary = directory.find(row => row.party.id === lead.id);
  assert.equal(leadSummary.owner, owner.name);
  assert.equal(leadSummary.opportunityCount, 1);
  assert.equal(leadSummary.opportunityValue, 2000);
  assert.ok(leadSummary.lastActivity);
  assert.ok(directory.every(row => row.party.ownerId === owner.id));
  await seller.client('/api/historial/comentarios',{method:'POST',status:204,body:{partyId:lead.id,type:'Comentario',text:'Nota de prueba para la ficha.'}});
  const dossier = await (await seller.client('/api/clientes/' + lead.id + '/detalle')).json();
  assert.equal(dossier.owner, owner.name);
  assert.ok(dossier.createdAt);
  assert.ok(dossier.notes.some(note => note.description === 'Nota de prueba para la ficha.'));
  const quote = await (await seller.client('/api/cotizaciones', {method: 'POST', body: {
    partyId: lead.id, validUntil: statistics.end, taxRate: 16, terms: 'Transferencia',
    lines: [{productId:catalogItem.id,product: 'Monitor', quantity: 2, price: 1000}]
  }})).json();
  const linkedQuotes = await (await seller.client('/api/cotizaciones?ficha=' + lead.id)).json();
  assert.ok(linkedQuotes.some(row => row.id === quote.id) && linkedQuotes.every(row => row.partyId === lead.id));
  assert.deepEqual(await (await seller.client('/api/cotizaciones?ficha=0')).json(), []);
  console.log('Directorio de clientes, detalle, notas y cotizaciones por ficha verificados.');
  for (const status of ['Enviada', 'Aceptada']) {
    await seller.client('/api/cotizaciones/' + quote.id + '/estado', {
      method: 'PATCH', body: {status}, status: 204
    });
  }
  await seller.client('/api/ventas/cotizacion/' + quote.id, {method: 'POST', status: 409});
  const beforeConversion = await readDashboard(seller.client, 30);
  await seller.client('/api/clientes/' + lead.id + '/convertir', {method: 'POST'});
  const afterConversion = await readDashboard(seller.client, 30);
  assert.equal(afterConversion.newClients, beforeConversion.newClients + 1);
  const quotedSale = await (await seller.client('/api/ventas/cotizacion/' + quote.id, {method: 'POST'})).json();
  const assistantInput = {partyId: lead.id, objective:'Captar prospectos', need:'Preparar un webinar de demostración del equipo'};
  const suggestion = await (await manager.client('/api/marketing/asistente',{method:'POST',body:assistantInput})).json();
  assert.equal(suggestion.id, lead.id);
  assert.equal(suggestion.options[0].channel, 'Eventos');
  assert.ok(suggestion.campaignName.includes(lead.name));
  await seller.client('/api/marketing/asistente',{method:'POST',body:assistantInput,status:403});
  await manager.client('/api/marketing/asistente',{method:'POST',body:{...assistantInput,partyId:0},status:400});
  const attributionName = 'Campaña de prueba de rentabilidad';
  await manager.client('/api/marketing', {method:'POST',status:204,body:{
    name:attributionName,goal:'Probar atribución',channel:'Email',segment:'Prueba',status:'Activa',
    start:statistics.end,end:statistics.end,reached:4,leads:1,audienceIds:[lead.id]}});
  const campaign = (await (await admin('/api/marketing')).json()).find(item => item.name === attributionName);
  await admin('/api/marketing/' + campaign.id + '/origen', {method:'PUT',status:204,body:{
    partyId:lead.id,capturedOn:statistics.end,source:'Email',segment:'Prueba',cost:15}});
  const attribution = await (await admin('/api/marketing/atribucion')).json();
  const segment = attribution.report.find(item => item.campaign.id === campaign.id).segments[0];
  assert.equal(segment.prospects, 1);
  assert.equal(segment.soldProspects, 1);
  assert.equal(segment.quotes, 1);
  assert.equal(segment.sales, 1);
  assert.ok(segment.revenue > segment.cost);
  console.log('Asistente de campañas para Gerente, pronóstico por canal y atribución verificados.');
  await seller.client('/api/ventas/cotizacion/' + quote.id, {method: 'POST', status: 409});
  const quotedHistory = await (await seller.client('/api/ventas/' + quotedSale.id + '/historial')).json();
  assert.equal(quotedHistory[0].status, 'Registrada');
  assert.equal((await inventory()).stock,8);
  const movements = await (await admin('/api/inventario/' + catalogItem.id + '/movimientos')).json();
  assert.ok(movements.some(entry => entry.saleId === quotedSale.id && entry.type === 'Venta' && entry.delta === -2));

  if (verifyImprovements) {
    const change = (days) => new Date(Date.now()+days*86400000).toISOString();
    const late = await (await seller.client('/api/agenda',{method:'POST',body:{
      title:'Seguimiento urgente de verificación',type:'Seguimiento',status:'Pendiente',due:change(-3),partyId:party.id
    }})).json();
    const lateRow = (await (await seller.client('/api/agenda')).json()).find(x=>x.id===late.id);
    await seller.client('/api/notificaciones/preferencias',{method:'PUT',status:204,body:{
      quietFrom:0,quietUntil:0,escalationHours:24,priority:'Comercial'}});
    assert.ok((await (await admin('/api/notificaciones')).json()).some(x=>x.recordId===late.id && x.group==='Gerencia'));
    assert.ok((await (await seller.client('/api/inicio/prioridades')).json()).items.some(x=>x.id===late.id));
    await seller.client('/api/agenda/'+late.id,{method:'PUT',status:400,body:{...lateRow,due:change(1)}});
    await seller.client('/api/agenda/'+late.id,{method:'PUT',body:{...lateRow,due:change(1),rescheduleReason:'Petición del cliente'}});
    assert.equal((await (await seller.client('/api/agenda/'+late.id+'/cambios')).json())[0].reason,'Petición del cliente');
    assert.ok((await (await seller.client('/api/agenda/seguimiento')).json()).slots.length > 0);
    assert.ok((await (await seller.client('/api/historial?ficha='+party.id+'&tipo=Agenda')).json()).some(x=>x.description.includes('Petición del cliente')));
    await seller.client('/api/clientes/oportunidades/sugerencias');

    const email = 'duplicado@prueba.test';
    const createDup = async (name) => (await (await seller.client('/api/clientes',{method:'POST',body:{
      kind:'Prospecto',name,personType:'Empresa',stage:'Nuevo',email}})).json()).id;
    const target = await createDup('Ficha objetivo de fusión');
    const duplicate = await createDup('Ficha duplicada revisada');
    assert.ok((await (await seller.client('/api/clientes/duplicados?correo='+email+'&excluir='+target)).json()).some(x=>x.id===duplicate));
    await seller.client('/api/clientes/'+duplicate+'/contactos',{method:'POST',body:{name:'Contacto de fusión'}});
    await seller.client('/api/clientes/'+target+'/fusion',{method:'POST',status:403,body:{sourceId:duplicate,reason:'Coincidencia'}});
    await admin('/api/clientes/'+target+'/fusion',{method:'POST',status:204,body:{sourceId:duplicate,reason:'Correo confirmado'}});
    assert.ok((await (await admin('/api/clientes/'+target+'/detalle')).json()).contacts.some(x=>x.name==='Contacto de fusión'));

    const requestBody = {partyId:party.id,validUntil:statistics.end,taxRate:16,
      lines:[{productId:catalogItem.id,product:'Papel',quantity:2,price:200,discount:10}]};
    const discount = await (await seller.client('/api/cotizaciones',{method:'POST',body:requestBody})).json();
    const quotePath = '/api/cotizaciones/'+discount.id;
    const sendQuote = status => seller.client(quotePath+'/estado',{method:'PATCH',body:{status:'Enviada'},status});
    await sendQuote(409);
    let versions = await (await admin(quotePath+'/versiones')).json();
    await seller.client(quotePath+'/aprobacion',{method:'PUT',status:403,body:{revision:versions.revision,decision:'Aprobada',reason:'Prueba'}});
    await admin(quotePath+'/aprobacion',{method:'PUT',status:204,body:{revision:versions.revision,decision:'Aprobada',reason:'Margen revisado'}});
    await seller.client(quotePath,{method:'PUT',body:{...requestBody,lines:[{...requestBody.lines[0],price:210}]}});
    await sendQuote(409);
    versions = await (await admin(quotePath+'/versiones')).json();
    assert.equal(versions.versions.length,2);
    assert.equal(versions.versions[1].approval,'Aprobada');
    await admin(quotePath+'/aprobacion',{method:'PUT',status:204,body:{revision:versions.revision,decision:'Aprobada',reason:'Precio actualizado'}});
    await sendQuote(204);

    const fulfillmentPath = '/api/ventas/'+quotedSale.id+'/entregas';
    const fulfillment = {position:1,quantity:1,effectiveOn:statistics.end,promisedOn:statistics.end,reason:'Entrega parcial',requestId:randomUUID(),kind:'Entrega'};
    const delivery = await (await seller.client(fulfillmentPath,{method:'POST',body:fulfillment})).json();
    assert.equal((await (await seller.client(fulfillmentPath,{method:'POST',body:fulfillment})).json()).id,delivery.id);
    await admin(fulfillmentPath,{method:'POST',status:409,body:{...fulfillment,kind:'Devolución',quantity:2,requestId:randomUUID()}});
    await admin(fulfillmentPath,{method:'POST',body:{...fulfillment,kind:'Devolución',requestId:randomUUID()}});
    assert.equal((await inventory()).stock,9);
    await admin('/api/ventas/'+quotedSale.id+'/estado',{method:'PATCH',status:204,body:{status:'Cancelada',reason:'Devuelto'}});
    assert.equal((await inventory()).stock,10);
    assert.ok((await (await admin('/api/ventas/entregas/indicadores')).json()).onTime > 0);

    await admin('/api/proveedores/condiciones',{method:'PUT',status:204,body:{
      supplierId:supplier.id,productId:catalogItem.id,cost:44.5,leadDays:7}});
    const terms = await (await admin('/api/proveedores/comparar?producto='+catalogItem.id+'&cantidad=5')).json();
    assert.equal(terms[0].total,222.5);
    const order = await (await admin('/api/proveedores/ordenes',{method:'POST',body:{
      supplierId:supplier.id,productId:catalogItem.id,quantity:5}})).json();
    const setOrder = (status, expected=204) => admin('/api/proveedores/ordenes/'+order.id+'/estado',{method:'PUT',status:expected,body:{status}});
    await setOrder('Aprobada');
    assert.equal((await (await admin('/api/inventario/reposicion')).json()).find(x=>x.id===catalogItem.id).incoming,5);
    await setOrder('Recibida');
    await setOrder('Recibida',409);
    assert.equal((await inventory()).stock,15);

    const campaigns = await (await admin('/api/marketing/atribucion')).json();
    if (/^(1|true)$/i.test(process.env.BUMI_TEST_DEMO ?? '')) {
      assert.ok(campaigns.contacts.length > 0);
      assert.ok(campaigns.report.some(x=>x.segments.some(y=>y.revenue>0)));
      assert.ok(statistics.validation.length >= 5);
      assert.ok(statistics.variation);
    }
    const details = await (await seller.client('/api/estadisticas/operaciones?desde='+statistics.start+'&hasta='+statistics.end+'&responsable='+marketerId)).json();
    assert.ok(details.rows.length > 0 && details.rows.every(x=>x.owner===owner.name));
    for (const source of ['cotizaciones','cartera','oportunidades']) {
      const data = await (await seller.client('/api/estadisticas/registros?origen='+source+'&desde='+statistics.start+'&hasta='+statistics.end)).json();
      assert.ok(data.rows.length>0 && data.rows.every(x=>x.owner===owner.name));
    }
    await seller.client('/api/notificaciones/metricas');

    const alternate = session();
    await challenge(alternate,manager.name);
    await verify(alternate,manager.backup[2],true);
    const active = await (await manager.client('/api/auth/sesiones')).json();
    assert.equal(active.length,2);
    await manager.client('/api/auth/sesiones/'+active.find(x=>!x.current).id,{method:'DELETE',status:204});
    await alternate('/api/auth/me',{status:401});
    await manager.client('/api/auth/me');
    if (base.hostname === 'localhost') await verifyPasskeys({base, admin, session, challenge, password});
    console.log('Verificadas las mejoras de aprobación, devoluciones, compras, fusión, agenda, análisis, atribución y sesiones.');
  }

  await logout(manager.client);
  assert.equal((await challenge(manager.client, manager.name)).setup, null);
  await verify(manager.client, manager.code, false, 400);
  await verify(manager.client, manager.backup[0], true);
  await logout(manager.client);
  await challenge(manager.client, manager.name);
  await verify(manager.client, manager.backup[0], true, 400);
  const renewed = 'ClaveTemporalBUMI2026!';
  await logout(seller.client);
  await seller.client('/api/auth/recover', {method: 'POST', status: 204, body: {
    email: 'ventas@nexo.test', code: totp(seller.key, 1), recoveryCode: seller.backup[0], password: renewed
  }});
  await challenge(seller.client, seller.name, password, 401);
  await challenge(seller.client, seller.name, renewed);
  await verify(seller.client, seller.backup[1], true);
  const sellerPath = '/api/config/accounts/' + owner.id;
  await admin(sellerPath, {method:'DELETE',status:204});
  await admin(sellerPath, {method:'DELETE',status:204});
  await seller.client('/api/auth/me', {status:401});
  assert.ok(!(await (await admin('/api/config/accounts')).json()).some(account => account.id === owner.id));
  assert.ok((await (await admin('/api/agenda')).json()).some(item => item.id === task.id && item.ownerId === owner.id));
  await admin(sellerPath, {method:'PUT',body:{active:true},status:404});
  console.log('Eliminación de usuarios verificada con revocación de sesión y conservación del historial.');
  console.log('Verificados 2FA en cuatro roles, recuperación de contraseña, códigos de un solo uso, cuentas inactivas, agenda, historial, avisos, tablero, inventario transaccional, proveedores, pronóstico y ventas auditadas.');
} else if (process.env.BUMI_TEST_TOTP_KEY) {
  const pending = await challenge(request, 'admin');
  assert.equal(pending.setup, null);
  await verify(request, totp(process.env.BUMI_TEST_TOTP_KEY));
  const statistics = await (await request('/api/estadisticas')).json();
  assert.ok(Array.isArray(statistics.months));
  await logout(request);
  console.log('Verificadas la sesión en dos pasos y la API autenticada.');
}
