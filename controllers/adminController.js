const Cart = require('../models/Cart');
const User = require('../models/User');
const { obtenerProductoAmazon, obtenerProductoShein } = require('./searchController');
const { calcularPrecioFinal } = require('../utils/pricing');

// Avisa al CLIENTE (vía un 2.º webhook de Make) que su total ya está listo para pagar.
// Es opcional: si MAKE_WEBHOOK_CLIENTE_URL no está definida, no hace nada.
// Nunca debe tumbar la petición del admin: solo se loguea el error. Timeout de 10s para
// que un Make colgado no deje la promesa abierta.
// Eventos que se envian en el campo evento: 'pendiente_pago' (total listo para pagar),
// 'pagado' (pago confirmado) y 'completado' (pedido entregado). En Make se separan con un Router.
const notificarCliente = async (carrito, evento) => {
    if (!process.env.MAKE_WEBHOOK_CLIENTE_URL) return;

    try {
        const cliente = await User.findById(carrito.user).select('name phone');
        const subtotal = carrito.items.reduce((acc, item) => acc + item.precioFinalCliente, 0);
        const envio = carrito.costoEnvio || 0;

        const res = await fetch(process.env.MAKE_WEBHOOK_CLIENTE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(10000),
            body: JSON.stringify({
                evento,
                carritoId: carrito._id.toString(),
                numeroOrden: String(carrito._id).slice(-6),
                cliente: cliente?.name || '',
                telefono: cliente?.phone || '',
                subtotal: parseFloat(subtotal.toFixed(2)),
                envio: parseFloat(envio.toFixed(2)),
                total: parseFloat((subtotal + envio).toFixed(2)),
                listaProductos: carrito.items.map(i => `• ${i.title}`).join('\n')
            })
        });
        if (!res.ok) console.error(`⚠️ Make (aviso al cliente) respondió ${res.status}`);
    } catch (error) {
        console.error('⚠️ No se pudo avisar al cliente vía Make:', error.message);
    }
};

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
        const { costoEnvio } = req.body;

        if (costoEnvio === undefined || costoEnvio === null || Number(costoEnvio) < 0) {
            return res.status(400).json({ error: 'Debes indicar un costoEnvio válido (número mayor o igual a 0)' });
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

        carrito.costoEnvio = costoEnvio;
        carrito.status = 'pendiente_pago';
        await carrito.save();

        // Aviso automático al cliente (no bloquea la respuesta al admin)
        notificarCliente(carrito, 'pendiente_pago');

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

        // Aviso automatico al cliente (no bloquea la respuesta al admin)
        notificarCliente(carrito, 'pagado');

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

        // Aviso automatico al cliente (no bloquea la respuesta al admin)
        notificarCliente(carrito, 'completado');

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
                    subtotal: { $sum: '$items.precioFinalCliente' },
                    costoBase: { $sum: '$items.price' }
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
                    monto: { $sum: { $add: [{ $sum: '$items.precioFinalCliente' }, { $ifNull: ['$costoEnvio', 0] }] } }
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

module.exports = { obtenerCotizaciones, asignarCostoEnvio, confirmarPago, marcarCompletado, verificarPrecios, obtenerEstadisticas };
