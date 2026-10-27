const crypto = require('crypto');
const Cart = require('../models/Cart');
const User = require('../models/User');
const { normalizarTelefono } = require('./authController');
const { obtenerProductoAmazon, obtenerProductoShein } = require('./searchController');
const { calcularPrecioFinal } = require('../utils/pricing');

// 1. LISTAR CARRITOS POR ESTADO (por defecto "cotizando", pero admite ?status=pagado|completado)
const obtenerCotizaciones = async (req, res) => {
    try {
        const status = req.query.status || 'cotizando';
        const estadosValidos = ['cotizando', 'pendiente_pago', 'pagado', 'completado'];

        if (!estadosValidos.includes(status)) {
            return res.status(400).json({ error: `Estado inválido. Usa uno de: ${estadosValidos.join(', ')}` });
        }

        const carritos = await Cart.find({ status })
            .populate('user', 'name phone') // Traemos nombre y teléfono del cliente, sin la contraseña
            .sort({ updatedAt: -1 });

        res.json(carritos);
    } catch (error) {
        console.error('❌ Error al obtener cotizaciones:', error.message);
        res.status(500).json({ error: 'Error interno al obtener las cotizaciones' });
    }
};

// 2. ASIGNAR COSTO DE ENVÍO Y RESOLVER LA ORDEN (cotizando -> pagado)
const asignarCostoEnvio = async (req, res) => {
    try {
        const { id } = req.params;
        // Number.isFinite descarta texto ("abc" -> NaN), vacios e Infinity; el tope evita un error de tipeo
        // (ej. 1500 en vez de 15.00) que le mostraria al cliente un total absurdo.
        const valor = req.body.costoEnvio;
        const costoEnvio = typeof valor === 'number' || (typeof valor === 'string' && valor.trim() !== '') ? Number(valor) : NaN;
        if (!Number.isFinite(costoEnvio) || costoEnvio < 0 || costoEnvio > 1000) {
            return res.status(400).json({ error: 'Debes indicar un costoEnvio válido (número entre 0 y 1000)' });
        }

        const carrito = await Cart.findById(id);

        if (!carrito) {
            return res.status(404).json({ error: 'Carrito no encontrado' });
        }

        if (carrito.status !== 'cotizando') {
            return res.status(400).json({
                error: `Este carrito está en estado "${carrito.status}". Solo se puede asignar envío a carritos en "cotizando".`
            });
        }

        carrito.costoEnvio = parseFloat(costoEnvio.toFixed(2));
        carrito.status = 'pendiente_pago';
        await carrito.save();


        res.json({
            mensaje: '📦 Costo de envío asignado. Esperando que el cliente pague.',
            carrito
        });
    } catch (error) {
        console.error('❌ Error al asignar costo de envío:', error.message);
        res.status(500).json({ error: 'Error interno al asignar el envío' });
    }
};

// 3. CONFIRMAR QUE EL CLIENTE YA PAGÓ (pendiente_pago -> pagado)
// El pago ocurre fuera del sistema (WhatsApp, transferencia, etc.); este botón
// es el admin diciendo "ya verifiqué que entró el dinero".
const confirmarPago = async (req, res) => {
    try {
        const { id } = req.params;
        const carrito = await Cart.findById(id);

        if (!carrito) {
            return res.status(404).json({ error: 'Carrito no encontrado' });
        }

        if (carrito.status !== 'pendiente_pago') {
            return res.status(400).json({
                error: `Este carrito está en estado "${carrito.status}". Solo se puede confirmar el pago de un carrito en "pendiente_pago".`
            });
        }

        carrito.status = 'pagado';
        carrito.pagadoAt = new Date();
        await carrito.save();


        res.json({
            mensaje: '💰 Pago confirmado.',
            carrito
        });
    } catch (error) {
        console.error('❌ Error al confirmar el pago:', error.message);
        res.status(500).json({ error: 'Error interno al confirmar el pago' });
    }
};

// 4. MARCAR UN CARRITO PAGADO COMO COMPLETADO (entregado)
const marcarCompletado = async (req, res) => {
    try {
        const { id } = req.params;
        const carrito = await Cart.findById(id);

        if (!carrito) {
            return res.status(404).json({ error: 'Carrito no encontrado' });
        }

        if (carrito.status !== 'pagado') {
            return res.status(400).json({
                error: `Este carrito está en estado "${carrito.status}". Solo se puede completar un carrito en "pagado".`
            });
        }

        carrito.status = 'completado';
        await carrito.save();


        res.json({
            mensaje: '✅ Pedido marcado como completado.',
            carrito
        });
    } catch (error) {
        console.error('❌ Error al marcar como completado:', error.message);
        res.status(500).json({ error: 'Error interno al completar el pedido' });
    }
};

// 4. VERIFICAR PRECIOS ACTUALES vs los cotizados (antes de comprar en la tienda real)
// No modifica el carrito: solo compara. La decision de que hacer si cambio el
// precio queda en manos del admin.
const verificarPrecios = async (req, res) => {
    try {
        const { id } = req.params;
        const carrito = await Cart.findById(id);

        if (!carrito) {
            return res.status(404).json({ error: 'Carrito no encontrado' });
        }

        const items = await Promise.all(carrito.items.map(async (item) => {
            try {
                const actual = item.source === 'amazon'
                    ? await obtenerProductoAmazon(item.originalId)
                    : await obtenerProductoShein(item.originalId);

                const precioCotizado = item.precioFinalCliente;
                const precioActual = calcularPrecioFinal(actual.price);
                const diferencia = parseFloat((precioActual - precioCotizado).toFixed(2));

                return {
                    itemId: item._id,
                    titulo: item.title,
                    precioCotizado,
                    precioActual,
                    diferencia,
                    cambio: Math.abs(diferencia) >= 0.01
                };
            } catch (error) {
                return {
                    itemId: item._id,
                    titulo: item.title,
                    error: 'No se pudo verificar: ' + error.message
                };
            }
        }));

        res.json({ items });
    } catch (error) {
        console.error('❌ Error al verificar precios:', error.message);
        res.status(500).json({ error: 'Error interno al verificar los precios' });
    }
};

// 5. RESUMEN GENERAL PARA EL DASHBOARD DEL ADMIN
// "Facturado" = subtotal de productos + envío de pedidos con pago confirmado (pagado/completado).
// "Margen" = lo que ganas sobre el precio base de los productos (precioFinalCliente - price).
// Los pedidos pagados antes de existir `pagadoAt` usan updatedAt como aproximación.
// Suma de un campo de los items multiplicado por la cantidad (los items viejos sin cantidad valen 1)
const sumaItems = (campo) => ({
    $sum: { $map: { input: '$items', in: { $multiply: [`$$this.${campo}`, { $ifNull: ['$$this.cantidad', 1] }] } } }
});

const TIMEZONE_REPORTES = process.env.STATS_TIMEZONE || 'America/Santo_Domingo';

const obtenerEstadisticas = async (req, res) => {
    try {
        const [porEstado, porMes, porCobrar] = await Promise.all([
            Cart.aggregate([
                { $match: { status: { $ne: 'activo' } } },
                { $group: { _id: '$status', total: { $sum: 1 } } }
            ]),
            Cart.aggregate([
                { $match: { status: { $in: ['pagado', 'completado'] } } },
                { $addFields: {
                    fechaPago: { $ifNull: ['$pagadoAt', '$updatedAt'] },
                    subtotal: sumaItems('precioFinalCliente'),
                    costoBase: sumaItems('price')
                } },
                { $group: {
                    _id: { $dateToString: { format: '%Y-%m', date: '$fechaPago', timezone: TIMEZONE_REPORTES } },
                    pedidos: { $sum: 1 },
                    facturado: { $sum: { $add: ['$subtotal', { $ifNull: ['$costoEnvio', 0] }] } },
                    margen: { $sum: { $subtract: ['$subtotal', '$costoBase'] } }
                } },
                { $sort: { _id: -1 } },
                { $limit: 6 }
            ]),
            // Dinero que ya cotizaste pero aún no entra
            Cart.aggregate([
                { $match: { status: 'pendiente_pago' } },
                { $group: {
                    _id: null,
                    pedidos: { $sum: 1 },
                    monto: { $sum: { $add: [sumaItems('precioFinalCliente'), { $ifNull: ['$costoEnvio', 0] }] } }
                } }
            ])
        ]);

        const redondear = (n) => parseFloat((n || 0).toFixed(2));
        const conteos = { cotizando: 0, pendiente_pago: 0, pagado: 0, completado: 0 };
        porEstado.forEach(e => { conteos[e._id] = e.total; });

        const mesActualClave = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE_REPORTES, year: 'numeric', month: '2-digit' })
            .format(new Date()).slice(0, 7); // "2026-10"
        const meses = porMes.map(m => ({
            mes: m._id,
            pedidos: m.pedidos,
            facturado: redondear(m.facturado),
            margen: redondear(m.margen)
        }));
        const mesActual = meses.find(m => m.mes === mesActualClave)
            || { mes: mesActualClave, pedidos: 0, facturado: 0, margen: 0 };

        res.json({
            conteos,
            mesActual,
            porCobrar: { pedidos: porCobrar[0]?.pedidos || 0, monto: redondear(porCobrar[0]?.monto) },
            meses
        });
    } catch (error) {
        console.error('❌ Error al calcular estadísticas:', error.message);
        res.status(500).json({ error: 'Error interno al calcular las estadísticas' });
    }
};

// 6. RESTABLECER LA CONTRASEÑA DE UN CLIENTE (la olvido y te escribio por WhatsApp)
// Genera una contraseña temporal que el admin le envia; el cliente luego la cambia.
// Sin letras ni numeros que se confunden al leerlos (0/O, 1/l/I).
const ALFABETO_TEMPORAL = 'abcdefghjkmnpqrstuvwxyz23456789';
const restablecerPassword = async (req, res) => {
    try {
        const phone = normalizarTelefono(typeof req.body.phone === 'string' ? req.body.phone : '');
        const digitos = (phone || '').replace('+', '');
        if (digitos.length < 8) {
            return res.status(400).json({ error: 'Escribe el teléfono del cliente con código de país' });
        }

        // El cliente pudo registrarse con o sin "+": probamos ambas formas
        const user = await User.findOne({ phone: { $in: [`+${digitos}`, digitos] } });
        if (!user) {
            return res.status(404).json({ error: 'No hay ningún cliente con ese teléfono' });
        }
        if (user.role === 'admin') {
            return res.status(403).json({ error: 'Las cuentas de administrador no se restablecen desde aquí' });
        }

        const temporal = Array.from({ length: 8 }, () => ALFABETO_TEMPORAL[crypto.randomInt(ALFABETO_TEMPORAL.length)]).join('');
        user.password = temporal;
        await user.save();

        console.log(`🔑 Contraseña restablecida por el admin ${req.user.phone} para el cliente ${user.phone}`);
        res.json({ mensaje: 'Contraseña temporal generada', cliente: { name: user.name, phone: user.phone }, temporal });
    } catch (error) {
        console.error('❌ Error al restablecer la contraseña:', error.message);
        res.status(500).json({ error: 'Error interno al restablecer la contraseña' });
    }
};

module.exports = { restablecerPassword, obtenerCotizaciones, asignarCostoEnvio, confirmarPago, marcarCompletado, verificarPrecios, obtenerEstadisticas };
