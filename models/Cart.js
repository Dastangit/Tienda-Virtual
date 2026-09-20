const mongoose = require('mongoose');

// 1. Estructura de cada producto dentro del carrito (La "fotografía" del producto)
const cartItemSchema = new mongoose.Schema({
    originalId: { type: String, required: true },
    source: { type: String, required: true },
    title: { type: String, required: true },
    price: { type: Number, required: true }, // Precio original de la tienda
    precioFinalCliente: { type: Number, required: true }, // Tu precio calculado con el 20%
    image: { type: String }
});

// 2. Estructura principal del carrito
const cartSchema = new mongoose.Schema({
    // Enlazamos el carrito con el cliente usando su ID de MongoDB
    user: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'User'
    },
    // Lista de productos (usando la estructura que definimos arriba)
    items: [cartItemSchema],
    
    // Estado del carrito para tu control interno
    status: {
        type: String,
        default: 'activo',
        enum: ['activo', 'cotizando', 'pagado', 'completado']
    },

    // Costo de envío final, asignado por el administrador al resolver la cotización
    costoEnvio: {
        type: Number,
        default: 0
    }
}, { timestamps: true });

module.exports = mongoose.model('Cart', cartSchema);