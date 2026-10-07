const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { searchProduct, searchByKeyword } = require('../controllers/searchController');
const { protect } = require('../middleware/authMiddleware');

// Cada búsqueda (por ID exacto o por texto) consume créditos pagos de
// Scrapingdog/Omkar, así que ambas rutas requieren estar logueado Y tienen tope de uso.
//
// El límite es POR USUARIO (no por IP): por eso estos limitadores van DESPUES de
// "protect", que es quien deja el usuario en req.user. Un bot con muchas IPs pero
// una sola cuenta igual queda frenado; y varios clientes detras de la misma IP
// (ej. una red movil compartida) no se bloquean entre si.
// Los admin quedan exentos (verificar precios y pruebas no deben toparse con el tope).
const porUsuario = (req) => String(req.user._id);
const esAdmin = (req) => req.user?.role === 'admin';

// Palabra clave: SIEMPRE cuesta un crédito (no se cachea).
const keywordLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 20,
    keyGenerator: porUsuario,
    skip: esAdmin,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Hiciste muchas búsquedas seguidas. Espera unos minutos e inténtalo de nuevo.' }
});

// Detalle de producto (al abrir el modal): cuesta crédito solo si no está en caché,
// y Shein es el más caro/lento, así que el tope es algo más holgado que el de búsqueda.
const detailLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 40,
    keyGenerator: porUsuario,
    skip: esAdmin,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Abriste muchos productos seguidos. Espera unos minutos e inténtalo de nuevo.' }
});

// Busqueda EXACTA por ASIN (Amazon) o URL de producto (Shein). Cachea el resultado.
router.post('/', protect, detailLimiter, searchProduct);

// Busqueda por PALABRA CLAVE (texto libre). Devuelve una lista, no cachea nada todavia.
router.post('/query', protect, keywordLimiter, searchByKeyword);

module.exports = router;
