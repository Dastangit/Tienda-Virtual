const express = require('express');
const router = express.Router();
const { obtenerCotizaciones, asignarCostoEnvio } = require('../controllers/adminController');
const { protect, admin } = require('../middleware/authMiddleware');

// GET /api/admin/carritos -> lista los carritos en estado "cotizando" (pendientes de envío)
router.get('/carritos', protect, admin, obtenerCotizaciones);

// PUT /api/admin/carritos/:id/envio -> asigna el costo de envío final y pasa el carrito a "pagado"
router.put('/carritos/:id/envio', protect, admin, asignarCostoEnvio);

module.exports = router;
