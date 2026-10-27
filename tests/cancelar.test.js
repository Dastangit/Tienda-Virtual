const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

before(h.iniciar);
after(h.detener);

const pedido = async () => {
    const cliente = await h.crearCliente();
    await h.agregarProducto(cliente.token);
    const r = await h.api('/api/carrito/confirmar', { method: 'PUT', token: cliente.token });
    return { cliente, id: r.data.carrito._id };
};

test('el cliente cancela antes de pagar; otro cliente no puede', async () => {
    const { cliente, id } = await pedido();
    const otro = await h.crearCliente();
    assert.equal((await h.api(`/api/carrito/pedidos/${id}/cancelar`, { method: 'PUT', token: otro.token })).status, 404);
    assert.equal((await h.api('/api/carrito/pedidos/no-es-id/cancelar', { method: 'PUT', token: cliente.token })).status, 404);

    const r = await h.api(`/api/carrito/pedidos/${id}/cancelar`, { method: 'PUT', token: cliente.token });
    assert.equal(r.status, 200);
    const hist = await h.api('/api/carrito/historial', { token: cliente.token });
    assert.equal(hist.data.historial[0].estado, 'cancelado');
    assert.equal(hist.data.historial[0].canceladoPor, 'cliente');
    // Cancelar dos veces no vale
    assert.equal((await h.api(`/api/carrito/pedidos/${id}/cancelar`, { method: 'PUT', token: cliente.token })).status, 400);
});

test('el cliente no puede cancelar un pedido ya pagado; el admin si, y queda marcado para reembolso', async () => {
    const admin = await h.crearAdmin();
    const { cliente, id } = await pedido();
    await h.api(`/api/admin/carritos/${id}/envio`, { method: 'PUT', token: admin.token, body: { costoEnvio: 5 } });
    await h.api(`/api/admin/carritos/${id}/confirmar-pago`, { method: 'PUT', token: admin.token });

    assert.equal((await h.api(`/api/carrito/pedidos/${id}/cancelar`, { method: 'PUT', token: cliente.token })).status, 400);

    const r = await h.api(`/api/admin/carritos/${id}/cancelar`, { method: 'PUT', token: admin.token });
    assert.equal(r.status, 200);
    assert.match(r.data.mensaje, /devolverle el pago/);
    assert.equal(r.data.carrito.estadoAlCancelar, 'pagado');

    const lista = await h.api('/api/admin/carritos?status=cancelado', { token: admin.token });
    assert.ok(lista.data.some(c => c._id === id));
    const stats = await h.api('/api/admin/stats', { token: admin.token });
    assert.ok(stats.data.conteos.cancelado >= 1);
});

test('los cancelados no cuentan como facturado ni por cobrar, y no se cancela un completado', async () => {
    const admin = await h.crearAdmin();
    const antes = (await h.api('/api/admin/stats', { token: admin.token })).data;
    const { id } = await pedido();
    await h.api(`/api/admin/carritos/${id}/envio`, { method: 'PUT', token: admin.token, body: { costoEnvio: 5 } });
    await h.api(`/api/admin/carritos/${id}/cancelar`, { method: 'PUT', token: admin.token });
    const despues = (await h.api('/api/admin/stats', { token: admin.token })).data;
    assert.equal(despues.porCobrar.monto, antes.porCobrar.monto);
    assert.equal(despues.mesActual.facturado, antes.mesActual.facturado);

    const otro = await pedido();
    await h.api(`/api/admin/carritos/${otro.id}/envio`, { method: 'PUT', token: admin.token, body: { costoEnvio: 1 } });
    await h.api(`/api/admin/carritos/${otro.id}/confirmar-pago`, { method: 'PUT', token: admin.token });
    await h.api(`/api/admin/carritos/${otro.id}/completar`, { method: 'PUT', token: admin.token });
    assert.equal((await h.api(`/api/admin/carritos/${otro.id}/cancelar`, { method: 'PUT', token: admin.token })).status, 400);
});
