const Cart = require('../models/Cart');
const ProductCache = require('../models/ProductCache');
const { calcularPrecioFinal } = require('../utils/pricing');

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
        const { originalId, source } = req.body;

        if (!originalId || !source) {
            return res.status(400).json({ error: 'Se requiere originalId y source' });
        }

        // REGLA DE SEGURIDAD: nunca confiar en el precio que manda el cliente.
        // El precio real y el margen del 20% se calculan SIEMPRE server-side,
        // tomando el producto tal como quedó guardado por /api/search.
        const productoCache = await ProductCache.findOne({ originalId, source });
        if (!productoCache) {
            return res.status(404).json({ error: 'Producto no encontrado en caché. Búscalo primero con /api/search antes de agregarlo al carrito.' });
        }

        const title = productoCache.title;
        const price = productoCache.price;
        const precioFinalCliente = calcularPrecioFinal(price);
        const image = productoCache.images && productoCache.images[0];

        // Buscamos si el usuario ya tiene un carrito abierto
        let carrito = await Cart.findOne({ user: req.user._id, status: 'activo' });

        if (!carrito) {
            // Si no tiene carrito, le creamos uno nuevo vacío
            carrito = new Cart({
                user: req.user._id,
                items: []
            });
        } else if (carrito.items.length > 0) {
            // REGLA DE NEGOCIO: No mezclar Amazon con Shein
            const fuenteActual = carrito.items[0].source;
            if (fuenteActual !== source) {
                return res.status(400).json({ 
                    error: `No puedes mezclar productos. Este carrito ya contiene artículos de ${fuenteActual.toUpperCase()}. Termina esta cotización para empezar a comprar en ${source.toUpperCase()}.` 
                });
            }
        }

        carrito.items.push({ originalId, source, title, price, precioFinalCliente, image });
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

// Le avisa a Make (Telegram) que hay una cotizacion nueva.
// No debe tumbar la peticion del cliente si Make falla: solo se loguea el error.
const notificarNuevaCotizacion = async (carrito, cliente) => {
    if (!process.env.MAKE_WEBHOOK_URL) return;

    try {
        const subtotal = carrito.items.reduce((acc, item) => acc + item.precioFinalCliente, 0);
        const listaProductos = carrito.items
            .map(item => `• ${item.title} — $${item.precioFinalCliente}`)
            .join('\n');

        await fetch(process.env.MAKE_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                carritoId: carrito._id.toString(),
                cliente: cliente.email,
                fuente: carrito.items[0].source.toUpperCase(),
                cantidadProductos: carrito.items.length,
                subtotal: parseFloat(subtotal.toFixed(2)),
                listaProductos
            })
        });
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

// 5. GENERAR TICKET DE COMPRA (Checkout)
const generarTicket = async (req, res) => {
    try {
        // Buscamos un carrito que ya haya solicitado cotización
        const carrito = await Cart.findOne({ 
            user: req.user._id, 
            status: { $in: ['cotizando', 'pagado'] } 
        });

        if (!carrito || carrito.items.length === 0) {
            return res.status(404).json({ error: 'No tienes órdenes en proceso de cotización.' });
        }

        const fuente = carrito.items[0].source.toUpperCase();
        const subtotal = carrito.items.reduce((acc, item) => acc + item.precioFinalCliente, 0);

        const ticket = {
            numeroOrden: carrito._id,
            fecha: carrito.updatedAt,
            estado: carrito.status, // 'cotizando' (esperando envío) o 'pagado' (envío ya asignado)
            tiendaOrigen: fuente,
            productos: carrito.items.map(item => ({
                titulo: item.title,
                precio: item.precioFinalCliente
            })),
            desglose: {
                subtotal: parseFloat(subtotal.toFixed(2)),
                envio: parseFloat((carrito.costoEnvio || 0).toFixed(2)),
                totalPagar: parseFloat((subtotal + (carrito.costoEnvio || 0)).toFixed(2))
            },
            instrucciones: "Usa este resumen para realizar el pago off-platform."
        };

        res.json({ ticket });
    } catch (error) {
        console.error('❌ Error al generar el ticket:', error.message);
        res.status(500).json({ error: 'Error interno al generar el ticket' });
    }
};

// ==========================================
// EXPORTACIÓN ÚNICA (Siempre al final del archivo)
// ==========================================
module.exports = { 
    obtenerCarrito, 
    agregarAlCarrito, 
    eliminarDelCarrito, 
    confirmarCotizacion,
    generarTicket
};
