const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const Cart = require('../models/Cart');

before(h.iniciar);
after(h.detener);

test('agregar el mismo producto dos veces suma una unidad (no repite la linea)', async () => {
    const cliente = await h.crearCliente();
    await h.agregarProducto(cliente.token);
    const r = await h.agregarProducto(cliente.token);
    assert.equal(r.data.carrito.items.length, 1);
    assert.equal(r.data.carrito.items[0].cantidad, 2);
});

test('cambiar la cantidad: valida 1..20 y solo en el carrito propio', async () => {
    const cliente = await h.crearCliente();
    const otro = await h.crearCliente();
    const r = await h.agregarProducto(cliente.token);
    const itemId = r.data.carrito.items[0]._id;
    for (const cantidad of [0, 21, 1.5, '3', null]) {
        assert.equal((await h.api(`/api/carrito/${itemId}`, { method: 'PUT', token: cliente.token, body: { cantidad } })).status, 400, `cantidad=${cantidad}`);
    }
    assert.equal((await h.api(`/api/carrito/${itemId}`, { method: 'PUT', token: otro.token, body: { cantidad: 3 } })).status, 404);
    const ok = await h.api(`/api/carrito/${itemId}`, { method: 'PUT', token: cliente.token, body: { cantidad: 3 } });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.carrito.items[0].cantidad, 3);
});

test('totales con cantidad: historial, por cobrar y facturado/margen del mes', async () => {
    const admin = await h.crearAdmin();
    const cliente = await h.crearCliente();
    const r = await h.agregarProducto(cliente.token);              // 12 c/u (10 + 20%)
    await h.api(`/api/carrito/${r.data.carrito.items[0]._id}`, { method: 'PUT', token: cliente.token, body: { cantidad: 3 } });
    const conf = await h.api('/api/carrito/confirmar', { method: 'PUT', token: cliente.token });
    const id = conf.data.carrito._id;

    const hist = await h.api('/api/carrito/historial', { token: cliente.token });
    assert.equal(hist.data.historial[0].productos[0].cantidad, 3);
    assert.equal(hist.data.historial[0].desglose.subtotal, 36);

    await h.api(`/api/admin/carritos/${id}/envio`, { method: 'PUT', token: admin.token, body: { costoEnvio: 4 } });
    let stats = await h.api('/api/admin/stats', { token: admin.token });
    assert.equal(stats.data.porCobrar.monto, 40);

    await h.api(`/api/admin/carritos/${id}/confirmar-pago`, { method: 'PUT', token: admin.token });
    stats = await h.api('/api/admin/stats', { token: admin.token });
    assert.equal(stats.data.mesActual.facturado, 40);  // 36 + 4 de envio
    assert.equal(stats.data.mesActual.margen, 6);      // (12 - 10) x 3
});

test('pedidos viejos sin campo cantidad cuentan como 1', async () => {
    const admin = await h.crearAdmin();
    const cliente = await h.crearCliente();
    await Cart.collection.insertOne({
        user: new (require('mongoose').Types.ObjectId)(cliente._id),
        status: 'pendiente_pago', costoEnvio: 0,
        items: [{ originalId: 'B0VIEJO001', source: 'amazon', title: 'Viejo', price: 10, precioFinalCliente: 12 }],
        createdAt: new Date(), updatedAt: new Date()
    });
    const hist = await h.api('/api/carrito/historial', { token: cliente.token });
    assert.equal(hist.data.historial[0].desglose.subtotal, 12);
    const stats = await h.api('/api/admin/stats', { token: admin.token });
    assert.ok(stats.data.porCobrar.monto >= 12);
});
