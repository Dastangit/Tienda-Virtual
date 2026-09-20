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

// Exportamos el modelo para que el controlador lo pueda usar
module.exports = mongoose.model('ProductCache', productCacheSchema);