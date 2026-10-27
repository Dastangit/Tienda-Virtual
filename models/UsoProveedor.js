const mongoose = require('mongoose');

// Un documento por dia (_id = "2026-10-26") con cuantas llamadas pagadas se hicieron a
// Scrapingdog/Omkar. Se guarda en la base (no en memoria) para que el tope diario no se
// reinicie cuando Render duerme o reinicia el servidor. Se borra solo a los 30 dias.
const usoProveedorSchema = new mongoose.Schema({
    _id: { type: String },
    llamadas: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now, expires: 30 * 24 * 60 * 60 }
});

module.exports = mongoose.model('UsoProveedor', usoProveedorSchema);
