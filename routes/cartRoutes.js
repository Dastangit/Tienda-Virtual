const express = require('express');
const router = express.Router();
const { obtenerCarrito, agregarAlCarrito, eliminarDelCarrito, confirmarCotizacion, generarTicket } = require('../controllers/cartController');
const { protect } = require('../middleware/authMiddleware');

router.get('/', protect, obtenerCarrito);
router.post('/', protect, agregarAlCarrito);

// Ruta para confirmar y bloquear el carrito: PUT /api/carrito/confirmar
router.put('/confirmar', protect, confirmarCotizacion);

// Ruta para generar el ticket: GET /api/carrito/ticket
router.get('/ticket', protect, generarTicket);

// Ruta para eliminar un producto: DELETE /api/carrito/:itemId
router.delete('/:itemId', protect, eliminarDelCarrito);

module.exports = router;