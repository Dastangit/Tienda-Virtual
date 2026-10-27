const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

before(h.iniciar);
after(h.detener);

// Crea un pedido en "cotizando" y devuelve su id
const pedidoCotizando = async () => {
    const cliente = await h.crearCliente();
    await h.agregarProducto(cliente.token);
    const r = await h.api('/api/carrito/confirmar', { method: 'PUT', token: cliente.token });
    return { cliente, id: r.data.carrito._id };
};

test('costo de envio invalido: texto, negativo, vacio, booleano o absurdo -> 400', async () => {
    const admin = await h.crearAdmin();
    const { id } = await pedidoCotizando();
    for (const costoEnvio of ['abc', -1, '', null, true, 5000, undefined]) {
        const r = await h.api(`/api/admin/carritos/${id}/envio`, { method: 'PUT', token: admin.token, body: { costoEnvio } });
        assert.equal(r.status, 400, `costoEnvio=${costoEnvio}`);
    }
});

test('costo de envio valido (texto numerico) -> pendiente_pago y se redondea', async () => {
    const admin = await h.crearAdmin();
    const { id } = await pedidoCotizando();
    const r = await h.api(`/api/admin/carritos/${id}/envio`, { method: 'PUT', token: admin.token, body: { costoEnvio: '7.556' } });
    assert.equal(r.status, 200);
    assert.equal(r.data.carrito.status, 'pendiente_pago');
    assert.equal(r.data.carrito.costoEnvio, 7.56);
});

test('id de carrito mal formado -> 404 (no 500)', async () => {
    const admin = await h.crearAdmin();
    const r = await h.api('/api/admin/carritos/no-es-un-id/envio', { method: 'PUT', token: admin.token, body: { costoEnvio: 5 } });
    assert.equal(r.status, 404);
});

test('flujo completo: envio -> pago -> completado, y el cliente no puede usar rutas de admin', async () => {
    const admin = await h.crearAdmin();
    const { cliente, id } = await pedidoCotizando();
    assert.equal((await h.api(`/api/admin/carritos/${id}/envio`, { method: 'PUT', token: cliente.token, body: { costoEnvio: 5 } })).status, 403);
    assert.equal((await h.api(`/api/admin/carritos/${id}/envio`, { method: 'PUT', token: admin.token, body: { costoEnvio: 5 } })).status, 200);
    assert.equal((await h.api(`/api/admin/carritos/${id}/confirmar-pago`, { method: 'PUT', token: admin.token })).status, 200);
    assert.equal((await h.api(`/api/admin/carritos/${id}/completar`, { method: 'PUT', token: admin.token })).status, 200);
    const hist = await h.api('/api/carrito/historial', { token: cliente.token });
    assert.equal(hist.data.historial[0].estado, 'completado');
    assert.equal(hist.data.historial[0].desglose.totalPagar, 17); // 12 + 5
});
