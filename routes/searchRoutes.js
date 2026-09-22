const express = require('express');
const router = express.Router();
const { searchProduct, searchByKeyword } = require('../controllers/searchController');

// Busqueda EXACTA por ASIN (Amazon) o URL de producto (Shein). Cachea el resultado.
router.post('/', searchProduct);

// Busqueda por PALABRA CLAVE (texto libre). Devuelve una lista, no cachea nada todavia.
router.post('/query', searchByKeyword);

module.exports = router;
