const express = require('express');
const router = express.Router();
const { obtenerCotizaciones, asignarCostoEnvio, marcarCompletado, verificarPrecios } = require('../controllers/adminController');
const { protect, admin } = require('../middleware/authMiddleware');

// GET /api/admin/carritos?status=cotizando|pagado|completado -> lista carritos por estado (por defecto "cotizando")
router.get('/carritos', protect, admin, obtenerCotizaciones);

// PUT /api/admin/carritos/:id/envio -> asigna el costo de envío final y pasa el carrito a "pagado"
router.put('/carritos/:id/envio', protect, admin, asignarCostoEnvio);

// PUT /api/admin/carritos/:id/completar -> marca un carrito "pagado" como "completado" (entregado)
router.put('/carritos/:id/completar', protect, admin, marcarCompletado);

// GET /api/admin/carritos/:id/verificar-precios -> compara precio cotizado vs precio actual en la tienda
router.get('/carritos/:id/verificar-precios', protect, admin, verificarPrecios);

module.exports = router;
