const express = require('express');
const router = express.Router();
const { obtenerCotizaciones, asignarCostoEnvio, confirmarPago, marcarCompletado, verificarPrecios, obtenerEstadisticas } = require('../controllers/adminController');
const { protect, admin } = require('../middleware/authMiddleware');

// GET /api/admin/stats -> resumen general: pedidos por estado, facturado/margen del mes, por cobrar
router.get('/stats', protect, admin, obtenerEstadisticas);

// GET /api/admin/carritos?status=cotizando|pagado|completado -> lista carritos por estado (por defecto "cotizando")
router.get('/carritos', protect, admin, obtenerCotizaciones);

// PUT /api/admin/carritos/:id/envio -> asigna el costo de envío final y pasa el carrito a "pagado"
router.put('/carritos/:id/envio', protect, admin, asignarCostoEnvio);

// PUT /api/admin/carritos/:id/confirmar-pago -> pasa el carrito de pendiente_pago a pagado
router.put('/carritos/:id/confirmar-pago', protect, admin, confirmarPago);

// PUT /api/admin/carritos/:id/completar -> marca un carrito "pagado" como "completado" (entregado)
router.put('/carritos/:id/completar', protect, admin, marcarCompletado);

// GET /api/admin/carritos/:id/verificar-precios -> compara precio cotizado vs precio actual en la tienda
router.get('/carritos/:id/verificar-precios', protect, admin, verificarPrecios);

module.exports = router;
