const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
    const header = req.headers.authorization;

    // 1. Verificamos si la petición trae un token de autorización en sus cabeceras
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No autorizado, no se proporcionó ningún token' });
    }

    try {
        // El token llega así: "Bearer eyJhbGciOi..." -> tomamos la parte 1
        const token = header.split(' ')[1];

        // 2. Decodificamos el token usando la clave secreta de tu .env
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // 3. Buscamos al usuario en la base de datos por el ID que venía en el token
        // El .select('-password') es por seguridad: nunca traemos la contraseña
        const user = await User.findById(decoded.id).select('-password');

        // Si el usuario fue eliminado, el token ya no sirve
        if (!user) {
            return res.status(401).json({ error: 'No autorizado, el token pertenece a un usuario que ya no existe' });
        }

        req.user = user;

        // 4. Todo en orden, pasamos el control a la siguiente función (next)
        next();
    } catch (error) {
        console.error('❌ Acceso denegado. Token inválido:', error.message);
        res.status(401).json({ error: 'No autorizado, el token falló o expiró' });
    }
};

// Portero adicional: solo deja pasar si el usuario autenticado tiene rol 'admin'
// Se usa SIEMPRE después de "protect", ya que depende de req.user
const admin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ error: 'Acceso denegado: se requieren permisos de administrador' });
    }
};

module.exports = { protect, admin };
