const express = require('express');
const router = express.Router();
const { searchProduct, searchByKeyword } = require('../controllers/searchController');
const { protect } = require('../middleware/authMiddleware');

// Cada búsqueda (por ID exacto o por texto) consume créditos pagos de
// Scrapingdog/Apify, así que ambas rutas requieren estar logueado.

// Busqueda EXACTA por ASIN (Amazon) o URL de producto (Shein). Cachea el resultado.
router.post('/', protect, searchProduct);

// Busqueda por PALABRA CLAVE (texto libre). Devuelve una lista, no cachea nada todavia.
router.post('/query', protect, searchByKeyword);

module.exports = router;
