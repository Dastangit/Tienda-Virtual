const express = require('express');
const router = express.Router();
const { searchProduct } = require('../controllers/searchController');

// Cuando alguien haga un POST a esta ruta, ejecutamos el controlador
router.post('/', searchProduct);

module.exports = router;