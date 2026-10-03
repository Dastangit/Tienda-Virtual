const Cart = require('../models/Cart');
const { obtenerProductoAmazon, obtenerProductoShein } = require('./searchController');
const { calcularPrecioFinal } = require('../utils/pricing');

// 1. LISTAR CARRITOS POR ESTADO (por defecto "cotizando", pero admite ?status=pagado|completado)
const obtenerCotizaciones = async (req, res) => {
    try {
        const status = req.query.status || 'cotizando';
        const estadosValidos = ['cotizando', 'pagado', 'completado'];

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
        carrito.status = 'pagado';
        await carrito.save();

        res.json({
            mensaje: '📦 Costo de envío asignado. El carrito quedó marcado como "pagado".',
            carrito
        });
    } catch (error) {
        console.error('❌ Error al asignar costo de envío:', error.message);
        res.status(500).json({ error: 'Error interno al asignar el envío' });
    }
};

// 3. MARCAR UN CARRITO PAGADO COMO COMPLETADO (entregado)
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

module.exports = { obtenerCotizaciones, asignarCostoEnvio, marcarCompletado, verificarPrecios };
