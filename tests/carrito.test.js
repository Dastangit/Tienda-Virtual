const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const Cart = require('../models/Cart');

before(h.iniciar);
after(h.detener);

test('clics simultaneos en "Agregar": un solo carrito activo con todos los productos', async () => {
    const cliente = await h.crearCliente();
    const asins = Array.from({ length: 8 }, (_, i) => `B00000010${i}`);
    for (const originalId of asins) {
        await h.api('/api/search', { method: 'POST', token: cliente.token, body: { originalId, source: 'amazon' } });
    }
    const respuestas = await Promise.all(asins.map(originalId =>
        h.api('/api/carrito', { method: 'POST', token: cliente.token, body: { originalId, source: 'amazon' } })));
    respuestas.forEach(r => assert.equal(r.status, 201));
    const activos = await Cart.find({ user: cliente._id, status: 'activo' });
    assert.equal(activos.length, 1);
    assert.equal(activos[0].items.length, 8);
});

test('la base no permite dos carritos activos del mismo cliente', async () => {
    const cliente = await h.crearCliente();
    await Cart.create({ user: cliente._id, items: [] });
    await assert.rejects(Cart.create({ user: cliente._id, items: [] }), { code: 11000 });
    // Los ya confirmados no cuentan: puede tener varios en "cotizando"
    await Cart.create({ user: cliente._id, items: [], status: 'cotizando' });
    await Cart.create({ user: cliente._id, items: [], status: 'cotizando' });
});

test('el precio lo pone el servidor (20% de margen), no el cliente', async () => {
    const cliente = await h.crearCliente();
    await h.api('/api/search', { method: 'POST', token: cliente.token, body: { originalId: 'B000000003', source: 'amazon' } });
    const r = await h.api('/api/carrito', { method: 'POST', token: cliente.token, body: { originalId: 'B000000003', source: 'amazon', price: 0.01, precioFinalCliente: 0.01 } });
    assert.equal(r.data.carrito.items[0].precioFinalCliente, 12);
});

test('no se mezclan Amazon y Shein en el mismo carrito', async () => {
    const cliente = await h.crearCliente();
    await h.agregarProducto(cliente.token);
    await require('../models/ProductCache').create({ originalId: 'https://us.shein.com/x.html', source: 'shein', title: 'Blusa', price: 8 });
    const r = await h.api('/api/carrito', { method: 'POST', token: cliente.token, body: { originalId: 'https://us.shein.com/x.html', source: 'shein' } });
    assert.equal(r.status, 400);
});

test('un cliente no ve ni toca el carrito de otro', async () => {
    const a = await h.crearCliente();
    const b = await h.crearCliente();
    const r = await h.agregarProducto(a.token);
    const itemId = r.data.carrito.items[0]._id;
    await h.api(`/api/carrito/${itemId}`, { method: 'DELETE', token: b.token });
    const carritoA = await h.api('/api/carrito', { token: a.token });
    assert.equal(carritoA.data.items.length, 1);
    const carritoB = await h.api('/api/carrito', { token: b.token });
    assert.equal(carritoB.data.items.length, 0);
});

test('sin token no se puede usar el carrito ni buscar', async () => {
    assert.equal((await h.api('/api/carrito')).status, 401);
    assert.equal((await h.api('/api/search/query', { method: 'POST', body: { query: 'x', source: 'amazon' } })).status, 401);
});
