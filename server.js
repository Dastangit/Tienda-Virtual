// Importamos las herramientas que instalamos
const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');

// Importamos nuestra propia función de conexión a la base de datos
const connectDB = require('./config/db');

// 1. ABRIR LA CAJA FUERTE: Esto debe ir al principio para que las variables existan
dotenv.config();

// 2. CONECTAR A MONGODB: Ejecutamos la función que creaste en el paso anterior
connectDB();

// 3. CREAR EL SERVIDOR: Inicializamos Express
const app = express();

// 4. MIDDLEWARES: Configuraciones intermedias (los "porteros")
// cors() permite que tu futuro frontend (PWA) se comunique con este backend sin ser bloqueado
app.use(cors());
// express.json() es un traductor: convierte los datos que lleguen por internet en un formato que Node.js entiende
app.use(express.json());

// ---> AQUI CONECTAMOS TU NUEVO MOTOR DE BÚSQUEDA <---
const searchRoutes = require('./routes/searchRoutes');
app.use('/api/search', searchRoutes);
// ---------------------------------------------------

// 5. RUTA DE PRUEBA: Creamos una dirección temporal para saber que el servidor responde
app.get('/', (req, res) => {
    res.json({ mensaje: 'El motor del Proxy Shopping está en línea y esperando órdenes.' });
});

// ---> SISTEMA DE USUARIOS <---
const authRoutes = require('./routes/authRoutes');
app.use('/api/users', authRoutes);

// ---> SISTEMA DE CARRITO <---
const cartRoutes = require('./routes/cartRoutes');
app.use('/api/carrito', cartRoutes);
// ---------------------------------------------------

// ---> PANEL DE ADMINISTRACIÓN <---
const adminRoutes = require('./routes/adminRoutes');
app.use('/api/admin', adminRoutes);
// ---------------------------------------------------

// 6. ENCENDER EL MOTOR: Le decimos al servidor en qué "puerto" debe escuchar
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Servidor de Express encendido y corriendo en el puerto ${PORT}`);
});