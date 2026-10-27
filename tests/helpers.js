// Entorno de pruebas: MongoDB temporal en memoria (no toca Atlas), la app en un puerto libre
// y respuestas falsas de Scrapingdog/Omkar (no se gastan creditos).
process.env.JWT_SECRET = 'secreto-de-pruebas';
process.env.SCRAPINGDOG_API_KEY = 'falsa';
process.env.OMKAR_SHEIN_API_KEY = 'falsa';
delete process.env.MAKE_WEBHOOK_URL;

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../server');
const User = require('../models/User');

const fetchReal = globalThis.fetch;
// Cuantas veces se llamo al proveedor externo (para comprobar el cache y el tope diario)
const proveedor = { llamadas: 0 };

// Producto falso de Amazon: precio 10 -> el cliente ve 12 (margen 20%)
globalThis.fetch = async (url, options) => {
    const u = String(url);
    if (u.startsWith('https://api.scrapingdog.com/amazon/product')) {
        proveedor.llamadas++;
        const asin = new URL(u).searchParams.get('asin');
        return Response.json({ title: `Producto ${asin}`, price: 10, images: ['https://example.com/a.jpg'] });
    }
    if (u.startsWith('https://api.scrapingdog.com/amazon/search')) {
        proveedor.llamadas++;
        return Response.json({ results: [{ asin: 'B000000001', title: 'Taza', extracted_price: 5, rating: 4.5, reviews: 100 }] });
    }
    if (u.includes('omkar.cloud')) {
        proveedor.llamadas++;
        return Response.json({ results: [] });
    }
    return fetchReal(url, options);
};

let mongo;
let server;
let base;

const iniciar = async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    await Promise.all(Object.values(mongoose.models).map(m => m.syncIndexes()));
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
};

const detener = async () => {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    await mongo.stop();
};

// Cada prueba usa una IP distinta (X-Forwarded-For) para no chocar con los limites por IP.
let ipFalsa = 1;
const api = async (path, { method = 'GET', body, token } = {}) => {
    const headers = { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.0.0.${ipFalsa}` };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetchReal(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
};
const nuevaIp = () => { ipFalsa++; };

let telefono = 18095550000;
const crearCliente = async () => {
    nuevaIp();
    const { data } = await api('/api/users/register', {
        method: 'POST',
        body: { name: 'Cliente Prueba', phone: `+${++telefono}`, password: 'secreta123' }
    });
    return data;
};

const crearAdmin = async () => {
    const cliente = await crearCliente();
    await User.updateOne({ _id: cliente._id }, { role: 'admin' });
    nuevaIp();
    const { data } = await api('/api/users/login', { method: 'POST', body: { phone: cliente.phone, password: 'secreta123' } });
    return data;
};

// Agrega un producto de Amazon al carrito del cliente (lo "abre" primero, como hace la web)
const agregarProducto = async (token, asin = 'B000000001') => {
    await api('/api/search', { method: 'POST', token, body: { originalId: asin, source: 'amazon' } });
    return api('/api/carrito', { method: 'POST', token, body: { originalId: asin, source: 'amazon' } });
};

module.exports = { iniciar, detener, api, nuevaIp, crearCliente, crearAdmin, agregarProducto, proveedor };
