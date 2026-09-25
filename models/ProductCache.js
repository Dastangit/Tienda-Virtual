const mongoose = require('mongoose');

// Definimos la estructura de los datos que guardaremos
const productCacheSchema = new mongoose.Schema({
    originalId: { 
        type: String, 
        required: true 
    },
    source: { 
        type: String, 
        required: true 
    },
    title: { type: String },
    price: { type: Number },
    currency: { type: String },
    images: [{ type: String }],
    
    // MAGIA DE MONGODB ATLAS: Índice TTL (Time-To-Live)
    // Esto le dice a la base de datos que borre este documento automáticamente 
    // cuando pasen 86400 segundos (24 horas) desde su creación.
    createdAt: { 
        type: Date, 
        default: Date.now, 
        expires: 86400 
    }
});

// Evita duplicados si dos búsquedas del mismo producto llegan casi a la vez
// (sin esto, agregarAlCarrito podría tomar por findOne un documento viejo
// mientras existe otro más reciente para el mismo originalId+source).
productCacheSchema.index({ originalId: 1, source: 1 }, { unique: true });

// Exportamos el modelo para que el controlador lo pueda usar
module.exports = mongoose.model('ProductCache', productCacheSchema);