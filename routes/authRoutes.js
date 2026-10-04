const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { registrarUsuario, loginUsuario } = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware'); // <-- 1. Importamos al portero

// Freno contra fuerza bruta: maximo 10 intentos de login por IP cada 15 minutos
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.' }
});

// Freno para registros masivos: maximo 20 cuentas nuevas por IP cada hora
const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados registros desde esta conexión. Inténtalo más tarde.' }
});

// Rutas Públicas (No necesitan token)
router.post('/register', registerLimiter, registrarUsuario);
router.post('/login', loginLimiter, loginUsuario);

// Ruta Privada (Protegida por el middleware)
// Fíjate cómo ponemos "protect" en el medio
router.get('/perfil', protect, (req, res) => {
    res.json({
        mensaje: '¡Bienvenido a la zona segura!',
        datosCliente: req.user // Estos datos los extrajo el portero de la base de datos
    });
});

module.exports = router;