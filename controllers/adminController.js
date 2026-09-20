const Cart = require('../models/Cart');

// 1. LISTAR CARRITOS PENDIENTES DE ENVÍO (estado "cotizando")
const obtenerCotizaciones = async (req, res) => {
    try {
        const carritos = await Cart.find({ status: 'cotizando' })
            .populate('user', 'name email'); // Traemos nombre y correo del cliente, sin la contraseña

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

module.exports = { obtenerCotizaciones, asignarCostoEnvio };
