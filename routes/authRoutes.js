const express = require('express');
const router = express.Router();
const { registrarUsuario, loginUsuario } = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware'); // <-- 1. Importamos al portero

// Rutas Públicas (No necesitan token)
router.post('/register', registrarUsuario);
router.post('/login', loginUsuario);

// Ruta Privada (Protegida por el middleware)
// Fíjate cómo ponemos "protect" en el medio
router.get('/perfil', protect, (req, res) => {
    res.json({
        mensaje: '¡Bienvenido a la zona segura!',
        datosCliente: req.user // Estos datos los extrajo el portero de la base de datos
    });
});

module.exports = router;