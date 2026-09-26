const User = require('../models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// Función interna para fabricar el gafete digital (JWT)
const generarToken = (id) => {
    // Usamos el secreto que guardaste en tu archivo .env
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: '30d', // El usuario se mantendrá logueado por 30 días
    });
};

// Normaliza el numero: solo digitos y un '+' inicial opcional (ej: "+1 809-555-1234" -> "+18095551234")
const normalizarTelefono = (phone) => {
    if (!phone) return phone;
    const limpio = phone.trim().replace(/[^\d+]/g, '');
    return limpio;
};

// 1. REGISTRAR NUEVO USUARIO
const registrarUsuario = async (req, res) => {
    try {
        const { name, password } = req.body;
        const phone = normalizarTelefono(req.body.phone);

        if (!phone || phone.replace('+', '').length < 8) {
            return res.status(400).json({ error: 'Ingresa un número de teléfono válido (con código de país, ej: +18095551234)' });
        }

        // Verificamos si el número ya existe en la base de datos
        const usuarioExiste = await User.findOne({ phone });
        if (usuarioExiste) {
            return res.status(400).json({ error: 'Este número ya está registrado' });
        }

        // Creamos al usuario (la contraseña se encripta automáticamente por la regla en User.js)
        const user = await User.create({
            name,
            phone,
            password
        });

        if (user) {
            res.status(201).json({
                _id: user.id,
                name: user.name,
                phone: user.phone,
                token: generarToken(user._id)
            });
        }
    } catch (error) {
        console.error('❌ Error al registrar usuario:', error.message);
        res.status(500).json({ error: 'Error interno del servidor al registrar' });
    }
};

// 2. INICIAR SESIÓN (LOGIN)
const loginUsuario = async (req, res) => {
    try {
        const phone = normalizarTelefono(req.body.phone);
        const { password } = req.body;

        // Buscamos al usuario por su número
        const user = await User.findOne({ phone });

        // Si el usuario existe y la contraseña encriptada coincide
        if (user && (await bcrypt.compare(password, user.password))) {
            res.json({
                _id: user.id,
                name: user.name,
                phone: user.phone,
                role: user.role,
                token: generarToken(user._id)
            });
        } else {
            res.status(401).json({ error: 'Credenciales inválidas (teléfono o contraseña incorrectos)' });
        }
    } catch (error) {
        console.error('❌ Error en el login:', error.message);
        res.status(500).json({ error: 'Error interno del servidor al iniciar sesión' });
    }
};

module.exports = { registrarUsuario, loginUsuario };
