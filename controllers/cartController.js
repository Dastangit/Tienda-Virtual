const mongoose = require('mongoose');
const Cart = require('../models/Cart');
const ProductCache = require('../models/ProductCache');
const { calcularPrecioFinal } = require('../utils/pricing');

const MAX_CANTIDAD = 20;
// Total de una linea del carrito (precio con margen x unidades) y del carrito completo
const totalItem = (item) => item.precioFinalCliente * (item.cantidad || 1);
const subtotalCarrito = (carrito) => parseFloat(carrito.items.reduce((acc, item) => acc + totalItem(item), 0).toFixed(2));

// 1. OBTENER EL CARRITO DEL USUARIO
const obtenerCarrito = async (req, res) => {
    try {
        let carrito = await Cart.findOne({ user: req.user._id, status: 'activo' });
        if (!carrito) {
            return res.json({ items: [] });
        }
        res.json(carrito);
    } catch (error) {
        console.error('❌ Error al obtener carrito:', error.message);
        res.status(500).json({ error: 'Error interno al obtener el carrito' });
    }
};

// 2. AGREGAR PRODUCTO AL CARRITO (Con separación de Fuentes)
const agregarAlCarrito = async (req, res) => {
    try {
        const { originalId, source, size, color } = req.body;

        if (typeof originalId !== 'string' || typeof source !== 'string' || !originalId || !source || originalId.length > 600) {
            return res.status(400).json({ error: 'Se requiere originalId y source' });
        }

        // REGLA DE SEGURIDAD: nunca confiar en el precio que manda el cliente.
        // El precio real y el margen del 20% se calculan SIEMPRE server-side,
        // tomando el producto tal como quedó guardado por /api/search.
        const productoCache = await ProductCache.findOne({ originalId, source });
        if (!productoCache) {
            return res.status(404).json({ error: 'Producto no encontrado en caché. Búscalo primero con /api/search antes de agregarlo al carrito.' });
        }

        // Si el producto maneja tallas, es obligatorio elegir una válida y con stock
        if (productoCache.sizes && productoCache.sizes.length > 0) {
            if (!size) {
                return res.status(400).json({ error: 'Este producto tiene tallas disponibles. Debes elegir una.' });
            }
            const tallaElegida = productoCache.sizes.find(s => s.size === size);
            if (!tallaElegida) {
                return res.status(400).json({ error: 'Talla inválida para este producto.' });
            }
            if (tallaElegida.inStock === false) {
                return res.status(400).json({ error: `La talla ${size} no tiene stock disponible.` });
            }
        }

        const title = productoCache.title;
        const price = productoCache.price;
        const precioFinalCliente = calcularPrecioFinal(price);
        const image = productoCache.images && productoCache.images[0];

        // Buscamos el carrito abierto del usuario o se lo creamos. Si dos peticiones llegan a la
        // vez (doble clic), el indice unico deja crear solo uno: la otra lo vuelve a buscar.
        let carrito = await Cart.findOne({ user: req.user._id, status: 'activo' });
        if (!carrito) {
            try {
                carrito = await Cart.create({ user: req.user._id, items: [] });
            } catch (error) {
                if (error.code !== 11000) throw error;
                carrito = await Cart.findOne({ user: req.user._id, status: 'activo' });
            }
        }

        if (carrito.items.length > 0) {
            // REGLA DE NEGOCIO: No mezclar Amazon con Shein
            const fuenteActual = carrito.items[0].source;
            if (fuenteActual !== source) {
                return res.status(400).json({ 
                    error: `No puedes mezclar productos. Este carrito ya contiene artículos de ${fuenteActual.toUpperCase()}. Termina esta cotización para empezar a comprar en ${source.toUpperCase()}.` 
                });
            }
        }

        // Mismo producto con la misma talla y color: se suma una unidad en vez de repetir la linea
        const repetido = carrito.items.find(i => i.originalId === originalId && (i.size || '') === (size || '') && (i.color || '') === (color || ''));
        if (repetido) {
            if ((repetido.cantidad || 1) >= MAX_CANTIDAD) {
                return res.status(400).json({ error: `Máximo ${MAX_CANTIDAD} unidades por producto.` });
            }
            repetido.cantidad = (repetido.cantidad || 1) + 1;
        } else {
            carrito.items.push({ originalId, source, title, price, precioFinalCliente, image, size, color });
        }
        await carrito.save();

        res.status(201).json({
            mensaje: `🛒 ¡Producto de ${source.toUpperCase()} agregado al carrito con éxito!`,
            carrito
        });
    } catch (error) {
        console.error('❌ Error al agregar al carrito:', error.message);
        res.status(500).json({ error: 'Error interno al guardar en el carrito' });
    }
};

// 3. ELIMINAR PRODUCTO DEL CARRITO
const eliminarDelCarrito = async (req, res) => {
    try {
        const { itemId } = req.params;
        let carrito = await Cart.findOne({ user: req.user._id, status: 'activo' });

        if (!carrito) {
            return res.status(404).json({ error: 'No se encontró un carrito activo' });
        }

        carrito.items = carrito.items.filter(item => item._id.toString() !== itemId);
        await carrito.save();

        res.json({
            mensaje: '🗑️ Producto eliminado del carrito con éxito',
            carrito
        });
    } catch (error) {
        console.error('❌ Error al eliminar del carrito:', error.message);
        res.status(500).json({ error: 'Error interno al eliminar el producto' });
    }
};

// 3b. CAMBIAR LA CANTIDAD DE UN PRODUCTO DEL CARRITO
const cambiarCantidad = async (req, res) => {
    try {
        const cantidad = req.body.cantidad;
        if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > MAX_CANTIDAD) {
            return res.status(400).json({ error: `La cantidad debe ser un número entero entre 1 y ${MAX_CANTIDAD}` });
        }

        const carrito = await Cart.findOne({ user: req.user._id, status: 'activo' });
        const item = carrito && carrito.items.find(i => i._id.toString() === req.params.itemId);
        if (!item) {
            return res.status(404).json({ error: 'Ese producto no está en tu carrito' });
        }

        item.cantidad = cantidad;
        await carrito.save();
        res.json({ mensaje: 'Cantidad actualizada', carrito });
    } catch (error) {
        console.error('❌ Error al cambiar la cantidad:', error.message);
        res.status(500).json({ error: 'Error interno al cambiar la cantidad' });
    }
};

// 3c. CANCELAR UN PEDIDO PROPIO (solo antes de pagar; despues de pagar se gestiona con el admin)
const cancelarPedido = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.isValidObjectId(id)) {
            return res.status(404).json({ error: 'Pedido no encontrado' });
        }

        // Filtrando por user, un cliente nunca puede cancelar el pedido de otro
        const carrito = await Cart.findOne({ _id: id, user: req.user._id });
        if (!carrito || carrito.status === 'activo') {
            return res.status(404).json({ error: 'Pedido no encontrado' });
        }
        if (!['cotizando', 'pendiente_pago'].includes(carrito.status)) {
            return res.status(400).json({ error: 'Este pedido ya no se puede cancelar desde aquí. Escríbenos por WhatsApp.' });
        }

        carrito.estadoAlCancelar = carrito.status;
        carrito.status = 'cancelado';
        carrito.canceladoAt = new Date();
        carrito.canceladoPor = 'cliente';
        await carrito.save();

        res.json({ mensaje: 'Pedido cancelado', carrito });
    } catch (error) {
        console.error('❌ Error al cancelar el pedido:', error.message);
        res.status(500).json({ error: 'Error interno al cancelar el pedido' });
    }
};

// Le avisa a Make (Telegram) que hay una cotizacion nueva.
// No debe tumbar la peticion del cliente si Make falla: solo se loguea el error.
const notificarNuevaCotizacion = async (carrito, cliente) => {
    if (!process.env.MAKE_WEBHOOK_URL) return;

    try {
        const subtotal = subtotalCarrito(carrito);
        const listaProductos = carrito.items
            .map(item => `• ${(item.cantidad || 1) > 1 ? `${item.cantidad} x ` : ''}${item.title} — $${item.precioFinalCliente}`)
            .join('\n');

        const res = await fetch(process.env.MAKE_WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // Clave opcional: si en Make activas "API key" en el webhook, solo pasan
                // las peticiones que traigan este header. Sin la variable, no se envia nada.
                ...(process.env.MAKE_WEBHOOK_SECRET ? { 'x-make-apikey': process.env.MAKE_WEBHOOK_SECRET } : {})
            },
            // Si Make se cuelga, no dejamos la promesa abierta indefinidamente.
            signal: AbortSignal.timeout(10000),
            body: JSON.stringify({
                carritoId: carrito._id.toString(),
                cliente: cliente.phone,
                fuente: carrito.items[0].source.toUpperCase(),
                cantidadProductos: carrito.items.reduce((acc, item) => acc + (item.cantidad || 1), 0),
                subtotal,
                listaProductos
            })
        });

        // fetch NO lanza error con respuestas 4xx/5xx (escenario apagado, clave mala...):
        // sin esta revision el aviso fallaba en silencio y no te enterabas de la cotizacion.
        if (!res.ok) {
            const detalle = (await res.text().catch(() => '')).slice(0, 200);
            console.error(`⚠️ Make rechazo el aviso de cotizacion ${carrito._id}: HTTP ${res.status} ${detalle}`);
        }
    } catch (error) {
        console.error('⚠️ No se pudo notificar a Make:', error.message);
    }
};

// 4. CONFIRMAR COTIZACIÓN (Pasar de 'activo' a 'cotizando')
const confirmarCotizacion = async (req, res) => {
    try {
        let carrito = await Cart.findOne({ user: req.user._id, status: 'activo' });

        if (!carrito || carrito.items.length === 0) {
            return res.status(400).json({ error: 'No tienes un carrito activo o está vacío' });
        }

        carrito.status = 'cotizando';
        await carrito.save();

        // Aviso a Make -> Telegram (no bloquea la respuesta al cliente si falla)
        notificarNuevaCotizacion(carrito, req.user);

        res.json({
            mensaje: '✅ ¡Cotización solicitada! El administrador calculará el envío pronto.',
            carrito
        });
    } catch (error) {
        console.error('❌ Error al confirmar cotización:', error.message);
        res.status(500).json({ error: 'Error interno al procesar la cotización' });
    }
};

// 5. FORMATO DE ORDEN
// Convierte un carrito de Mongo en el JSON de recibo que dibuja el frontend (Mis cotizaciones).
const formatearOrden = (carrito) => {
    const subtotal = subtotalCarrito(carrito);
    return {
        numeroOrden: carrito._id,
        fecha: carrito.updatedAt,
        estado: carrito.status, // 'cotizando' (esperando envio) | 'pendiente_pago' | 'pagado' | 'completado' | 'cancelado'
        canceladoPor: carrito.canceladoPor || '',
        tiendaOrigen: carrito.items[0]?.source?.toUpperCase() || '',
        productos: carrito.items.map(item => ({
            titulo: item.title,
            precio: item.precioFinalCliente, // por unidad
            cantidad: item.cantidad || 1,
            imagen: item.image || '',
            talla: item.size || '',
            color: item.color || ''
        })),
        desglose: {
            subtotal,
            envio: parseFloat((carrito.costoEnvio || 0).toFixed(2)),
            totalPagar: parseFloat((subtotal + (carrito.costoEnvio || 0)).toFixed(2))
        }
    };
};

// 6. HISTORIAL COMPLETO DE COTIZACIONES DEL CLIENTE ("Mis cotizaciones")
const obtenerHistorial = async (req, res) => {
    try {
        const carritos = await Cart.find({ user: req.user._id, status: { $ne: 'activo' } })
            .sort({ updatedAt: -1 });

        const historial = carritos.map(formatearOrden);
        res.json({ historial });
    } catch (error) {
        console.error('❌ Error al obtener historial:', error.message);
        res.status(500).json({ error: 'Error interno al obtener el historial' });
    }
};

// ==========================================
// EXPORTACIÓN ÚNICA (Siempre al final del archivo)
// ==========================================
module.exports = { 
    obtenerCarrito, 
    agregarAlCarrito, 
    eliminarDelCarrito, 
    cambiarCantidad,
    cancelarPedido,
    confirmarCotizacion,
    obtenerHistorial
};
