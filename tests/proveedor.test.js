const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const UsoProveedor = require('../models/UsoProveedor');

before(h.iniciar);
after(h.detener);

const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.STATS_TIMEZONE || 'America/Santo_Domingo' }).format(new Date());

test('cada busqueda nueva cuenta en el uso diario; la repetida sale del cache', async () => {
    const cliente = await h.crearCliente();
    const antes = h.proveedor.llamadas;
    const r1 = await h.api('/api/search/query', { method: 'POST', token: cliente.token, body: { query: 'taza', source: 'amazon' } });
    assert.equal(r1.status, 200);
    assert.equal(r1.data.resultados[0].precioFinalCliente, 6);
    await h.api('/api/search/query', { method: 'POST', token: cliente.token, body: { query: 'taza', source: 'amazon' } });
    assert.equal(h.proveedor.llamadas, antes + 1);
    const uso = await UsoProveedor.findById(hoy());
    assert.equal(uso.llamadas, 1);
});

test('al llegar al tope diario el cliente recibe 503 y no se llama al proveedor', async () => {
    await UsoProveedor.updateOne({ _id: hoy() }, { llamadas: 300 }, { upsert: true });
    const cliente = await h.crearCliente();
    const antes = h.proveedor.llamadas;
    const r = await h.api('/api/search', { method: 'POST', token: cliente.token, body: { originalId: 'B0TOPE0001', source: 'amazon' } });
    assert.equal(r.status, 503);
    assert.match(r.data.error, /límite de búsquedas/);
    assert.equal(h.proveedor.llamadas, antes);
});

test('el admin no se bloquea con el tope diario', async () => {
    const admin = await h.crearAdmin();
    const r = await h.api('/api/search', { method: 'POST', token: admin.token, body: { originalId: 'B0ADMIN001', source: 'amazon' } });
    assert.equal(r.status, 200);
    await UsoProveedor.deleteMany({});
});

test('si falla el proveedor, el cliente ve un aviso claro y el admin además el detalle', async () => {
    const cliente = await h.crearCliente();
    const r = await h.api('/api/search/query', { method: 'POST', token: cliente.token, body: { query: 'proveedor-caido', source: 'shein' } });
    assert.equal(r.status, 502);
    assert.equal(r.data.error, 'La búsqueda en Shein no está disponible en este momento. Inténtalo más tarde o busca en Amazon.');

    const admin = await h.crearAdmin();
    const ra = await h.api('/api/search/query', { method: 'POST', token: admin.token, body: { query: 'proveedor-caido', source: 'shein' } });
    assert.equal(ra.status, 502);
    assert.match(ra.data.error, /no está disponible.*\(Omkar Cloud \(Shein\) respondió 402\)/);
    await UsoProveedor.deleteMany({});
});

test('registro: maximo 5 cuentas por IP y hora', async () => {
    h.nuevaIp();
    const estados = [];
    for (let i = 0; i < 6; i++) {
        const r = await h.api('/api/users/register', { method: 'POST', body: { name: 'X', phone: `+1777000000${i}`, password: 'secreta123' } });
        estados.push(r.status);
    }
    assert.deepEqual(estados, [201, 201, 201, 201, 201, 429]);
});
