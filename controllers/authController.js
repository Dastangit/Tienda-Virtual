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

// 1. REGISTRAR NUEVO USUARIO
const registrarUsuario = async (req, res) => {
    try {
        const { name, email, password } = req.body;

        // Verificamos si el correo ya existe en la base de datos
        const usuarioExiste = await User.findOne({ email });
        if (usuarioExiste) {
            return res.status(400).json({ error: 'Este correo ya está registrado' });
        }

        // Creamos al usuario (la contraseña se encripta automáticamente por la regla en User.js)
        const user = await User.create({
            name,
            email,
            password
        });

        if (user) {
            res.status(201).json({
                _id: user.id,
                name: user.name,
                email: user.email,
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
        const { email, password } = req.body;

        // Buscamos al usuario por su correo
        const user = await User.findOne({ email });

        // Si el usuario existe y la contraseña encriptada coincide
        if (user && (await bcrypt.compare(password, user.password))) {
            res.json({
                _id: user.id,
                name: user.name,
                email: user.email,
                token: generarToken(user._id)
            });
        } else {
            res.status(401).json({ error: 'Credenciales inválidas (correo o contraseña incorrectos)' });
        }
    } catch (error) {
        console.error('❌ Error en el login:', error.message);
        res.status(500).json({ error: 'Error interno del servidor al iniciar sesión' });
    }
};

module.exports = { registrarUsuario, loginUsuario };