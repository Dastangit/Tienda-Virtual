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

---

## 🔎 Ajustes de Búsqueda (Oct 2026)
Auditoría de puntos débiles del buscador y correcciones aplicadas (`searchController.js`, `public/js/app.js`, `public/index.html`):
* **Calidad por defecto:** el filtro "4★ o más" ahora arranca activo y exige además un mínimo de 10 reseñas (`MIN_RESENAS` en `app.js`), para que "más baratos" no empiece con productos basura. El cliente puede apagarlo.
* **Reseñas como texto:** `parsearConteo()` convierte valores tipo "12.7K", "1,234" o "2M" a número en Amazon (`reviews` o `total_reviews`) y Shein (`reviews_count`). En pruebas reales Scrapingdog devolvió el conteo como número (redondeado).
* **Sets sin cantidad:** los títulos con "Set/Kit/Combo" sin número reciben `cantidadDesconocida`. La tarjeta muestra "Cantidad no indicada" y, con orden "precio por pieza", van al final de la lista.
* **Páginas:** `MAX_PAGINAS` baja de 10 a 4 en el servidor, igual que el tope de la pantalla.
* **Resultados en español:** Shein se consulta con `language=es` (tienda de EE.UU. en español, precios en USD; búsqueda, detalle, tallas, colores y categorías) y Amazon con `language=es_US` (traduce los títulos que el vendedor tiene en español; algunos listados siguen en inglés). Constantes `IDIOMA_SHEIN` e `IDIOMA_AMAZON` en `searchController.js`; el idioma forma parte de la clave de caché.
* **Sets en español:** `productParser.js` reconoce Conjunto, Juego, Paquete, Lote, pares, unidades, etc. "Conjunto" cuenta como set solo si el título trae la cantidad (ej. "Conjunto de 2 piezas"); sin número no se marca como set.
* **Caché de búsquedas:** el servidor guarda 10 minutos en memoria (máx. 200 entradas) lo que devuelve el proveedor. Repetir una búsqueda o cambiar a un orden que pide lo mismo a Shein no gasta otra llamada. Se vacía al reiniciar el servidor.
* **Diseño de escritorio:** el contenedor general (`.wrap` en `styles.css`) pasó de 720px a 1400px, así que en computadora el contenido ya no se ve como una columna de móvil. Los resultados usan una cuadrícula que se adapta al ancho (`auto-fill`, tarjetas de mínimo 190px, ~5 a 7 columnas). El formulario de búsqueda (900px), el carrito y el historial (880px) y el login (520px) se limitan y centran para que no se estiren. En móvil (menos de 560px) no cambia nada.
* **Revisión de seguridad y robustez:** `searchByKeyword`, `searchProduct` y el carrito validan que `query`, `originalId`, `source` sean texto (evita inyección de operadores Mongo y búsquedas basura que gastan crédito); la búsqueda se limita a 120 caracteres. `escapeHtml` en `app.js` ahora escapa también comillas y se usa en las URLs de imagen que llegan del proveedor. El detector de sets entiende números escritos ("Conjunto de dos piezas").
* **"Cargar más" por lotes:** la paginación de Shein se solapa (con orden por precio la página 2 repite ~37% de la 1 y vuelve a empezar por los más baratos; con relevancia ~12%; con más vendidos 0%; Amazon no repite). Por eso cada carga se agrega como un lote nuevo al final de la lista (ordenado por dentro con el criterio elegido), se quitan los repetidos, y un aviso indica cuántos productos nuevos llegaron y lleva la vista al primero. Si una página no trae nada nuevo, el botón desaparece. Se probó avanzar por tramos de precio (`min_price`) y se descartó: Omkar devuelve resultados incoherentes con ese filtro.
* **Limitaciones conocidas:** en Amazon "Más baratos" solo ordena lo ya cargado (~48 por página); el parámetro `sort_by=price-asc-rank` no tuvo efecto en Scrapingdog. En Shein, cambiar el rango de precio o el grupo de orden gasta una llamada; abrir el detalle de un producto fuera de caché también.
