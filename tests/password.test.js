const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

before(h.iniciar);
after(h.detener);

const login = (phone, password) => { h.nuevaIp(); return h.api('/api/users/login', { method: 'POST', body: { phone, password } }); };
const esperar = (ms) => new Promise(r => setTimeout(r, ms));

test('admin restablece: la temporal funciona, la vieja no, y la sesion vieja se cierra', async () => {
    const admin = await h.crearAdmin();
    const cliente = await h.crearCliente();
    await esperar(1100); // el token viejo tiene que ser de un segundo anterior al cambio

    // El admin escribe el numero con espacios y sin "+"
    const digitos = cliente.phone.replace('+', '');
    const r = await h.api('/api/admin/usuarios/restablecer-password', { method: 'POST', token: admin.token, body: { phone: `${digitos.slice(0, 4)} ${digitos.slice(4)}` } });
    assert.equal(r.status, 200);
    assert.match(r.data.temporal, /^[a-z2-9]{8}$/);

    assert.equal((await login(cliente.phone, 'secreta123')).status, 401);
    assert.equal((await login(cliente.phone, r.data.temporal)).status, 200);
    assert.equal((await h.api('/api/carrito', { token: cliente.token })).status, 401);
});

test('el cliente cambia su contraseña y sigue conectado con el token nuevo', async () => {
    const cliente = await h.crearCliente();
    await esperar(1100);
    h.nuevaIp();
    const mala = await h.api('/api/users/password', { method: 'PUT', token: cliente.token, body: { actual: 'equivocada', nueva: 'nueva1234' } });
    assert.equal(mala.status, 400);
    const corta = await h.api('/api/users/password', { method: 'PUT', token: cliente.token, body: { actual: 'secreta123', nueva: '123' } });
    assert.equal(corta.status, 400);

    const r = await h.api('/api/users/password', { method: 'PUT', token: cliente.token, body: { actual: 'secreta123', nueva: 'nueva1234' } });
    assert.equal(r.status, 200);
    assert.equal((await h.api('/api/carrito', { token: r.data.token })).status, 200);
    assert.equal((await h.api('/api/carrito', { token: cliente.token })).status, 401);
    assert.equal((await login(cliente.phone, 'nueva1234')).status, 200);
});

test('restablecer: solo admin, no a otros admin, y telefono inexistente -> 404', async () => {
    const admin = await h.crearAdmin();
    const otroAdmin = await h.crearAdmin();
    const cliente = await h.crearCliente();
    assert.equal((await h.api('/api/admin/usuarios/restablecer-password', { method: 'POST', token: cliente.token, body: { phone: cliente.phone } })).status, 403);
    assert.equal((await h.api('/api/admin/usuarios/restablecer-password', { method: 'POST', token: admin.token, body: { phone: otroAdmin.phone } })).status, 403);
    assert.equal((await h.api('/api/admin/usuarios/restablecer-password', { method: 'POST', token: admin.token, body: { phone: '+19999999999' } })).status, 404);
    assert.equal((await h.api('/api/admin/usuarios/restablecer-password', { method: 'POST', token: admin.token, body: { phone: { $ne: 1 } } })).status, 400);
});

test('el registro no deja tokens invalidos (passwordChangedAt solo al cambiar)', async () => {
    const cliente = await h.crearCliente();
    assert.equal((await h.api('/api/carrito', { token: cliente.token })).status, 200);
});
