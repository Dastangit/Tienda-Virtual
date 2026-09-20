# 🛒 Documentación Técnica: Plataforma Proxy Shopping

## 📌 Resumen del Proyecto
Arquitectura backend para un sistema de Proxy Shopping. Permite la búsqueda de productos, cálculo automático de márgenes de ganancia (20%), autenticación segura de usuarios y gestión de carritos de compra aislados y protegidos.

## 🛠 Stack Tecnológico
* **Entorno:** Node.js
* **Framework:** Express.js
* **Base de Datos:** MongoDB Atlas + Mongoose (ODM)
* **Seguridad:** `bcryptjs` (Hash de contraseñas), `jsonwebtoken` (Auth Tokens)

---

## ✅ FASE 1: Módulos Completados (Progreso Actual)

### 1. Configuración del Núcleo (`server.js`)
* Inicialización del servidor Express en el puerto `5000`.
* Middlewares globales configurados: `cors` para cruce de dominios y `express.json()` para parseo de datos.
* Conexión exitosa a MongoDB Atlas estableciendo persistencia en la nube.

### 2. Motor de Búsqueda y Cotización (`searchRoutes`, `searchController`)
* **Caché Eficiente:** Implementación de índice TTL (Time-To-Live) de 24 horas (`ProductCache`) para minimizar llamadas externas y acelerar respuestas.
* **Lógica de Negocios Blindada:** Cálculo automatizado en el servidor que toma el precio base y le suma estrictamente un **20% de ganancia** (`precioFinalCliente`). El manejo del peso y costo de envío internacional se aísla de esta etapa para gestionarse en trato directo.

### 3. Sistema de Usuarios y Seguridad (`authRoutes`, `authController`, `models/User.js`)
* **Modelo de Base de Datos:** Esquema Mongoose con validación de correos únicos.
* **Criptografía:** Contraseñas encriptadas de forma automática utilizando `bcryptjs` (Salt 10) antes del guardado.
* **Autenticación (JWT):** Generación de "gafetes digitales" mediante JSON Web Tokens, con una validez de sesión de 30 días.
* **Middleware Protector (`authMiddleware.js`):** Interceptor que verifica firmas JWT por cabeceras `Bearer`, extrayendo la identidad del usuario y bloqueando el acceso a clientes no autorizados.

### 4. Motor del Carrito de Compras (`cartRoutes`, `cartController`, `models/Cart.js`)
* **Snapshot de Precios:** El modelo almacena una "fotografía" del precio del producto al momento exacto de agregarlo, protegiendo la transacción contra fluctuaciones de mercado en la tienda de origen.
* **Gestión de Estados:** Soporte estructural para transiciones del ciclo de compra (estados: `activo`, `cotizando`, `pagado`, `completado`).
* **Inyección Segura:** Inserción de productos basada exclusivamente en el token validado (`req.user._id`), haciendo imposible la manipulación de carritos ajenos.

---

## 🚀 FASE 2: Hoja de Ruta Técnica (Lo que falta por construir)

### 1. Finalización del Módulo del Carrito
* **Remoción de Ítems:** Crear la ruta `DELETE /api/carrito/:idProducto` para que el cliente pueda limpiar su lista.
* **Confirmación de Cotización:** Crear el endpoint que cambie el estado del carrito de `activo` a `cotizando`, enviando una alerta al administrador para calcular el peso de envío.

### 2. Panel de Administración y Envíos (Backend)
* **Protección de Roles:** Expandir el middleware de autenticación para diferenciar entre clientes normales y cuentas de administrador.
* **Resolución de Órdenes:** Rutas para que el administrador asigne el costo de envío final a un carrito `cotizando` y lo pase a `pagado`.

### 3. Extracción Avanzada de Datos (Integración de APIs)
* Reemplazar la búsqueda de prueba con llamadas a tiendas reales (ej. Amazon).
* Implementar estrategias de Prompt Engineering conectando las APIs de modelos como Gemini, OpenAI o DeepSeek para estructurar la metadata cruda de los productos en formatos JSON perfectos antes de enviarlos al frontend.

### 4. Orquestación y Automatización
* Conectar el backend con plataformas low-code como **n8n** o **Make.com** vía webhooks. 
* *Objetivo:* Disparar flujos automatizados de mensajería (ej. confirmaciones por correo o alertas a tu teléfono) cada vez que un cliente solicite una cotización.

### 5. Desarrollo de Interfaz (Frontend)
* Consumo de la API actual para construir la interfaz visual.
* Opciones de arquitectura frontal: Desarrollar una aplicación móvil nativa utilizando **React Native** o una experiencia de navegador a través de una **PWA** (Progressive Web App).
* **Diseño UI:** Aplicación del sistema de variables de alto contraste (incorporando tonalidades como `#F5F4EF` para fondos y `#1C2624` para elementos principales).