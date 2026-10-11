const ProductCache = require('../models/ProductCache');
const { calcularPrecioFinal, precioOrigenDesdeFinal } = require('../utils/pricing');
const { detectarPaquete } = require('../utils/productParser');

// --- CONEXIÓN CON APIs EXTERNAS REALES ---

// fetch nativo de Node a veces falla con "fetch failed" por un hipo de red
// transitorio (común en Windows / detrás de VPN), sin que la API externa
// tenga la culpa. Un reintento simple resuelve la gran mayoría de estos casos.
const fetchConReintento = async (url, options = {}, intentos = 2, timeoutMs = 15000) => {
    for (let intento = 1; intento <= intentos; intento++) {
        try {
            // Si el proveedor externo se cuelga (sin responder ni dar error), despues
            // de 15s abortamos: sin esto, una API externa colgada deja la peticion
            // del cliente esperando para siempre, sin mensaje de error.
            return await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
        } catch (error) {
            const esUltimoIntento = intento === intentos;
            const esTimeoutLargo = error.name === 'TimeoutError' && timeoutMs > 15000;
            const motivo = error.name === 'TimeoutError' ? `tardo mas de ${timeoutMs / 1000}s en responder` : error.message;
            console.error(`⚠️ fetch falló (intento ${intento}/${intentos}): ${motivo}`);
            if (esUltimoIntento || esTimeoutLargo) throw new Error(error.name === 'TimeoutError' ? 'El proveedor externo no respondió a tiempo' : error.message);
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
    }
};

// Scrapingdog a veces manda el precio como texto con ruido alrededor,
// ej: "$17.99 with 49 percent savings". Un regex que solo quita letras
// arrastra los dígitos de "49" y arma un número incorrecto (17.9949).
// Por eso: 1) preferimos el precio ya parseado por Scrapingdog si existe,
// 2) si no, tomamos SOLO el primer número con forma de precio (x.xx).
const extraerPrecioAmazon = (data) => {
    const extraidoLimpio = data?.purchase_options?.single_offer?.extracted_price;
    if (typeof extraidoLimpio === 'number' && !Number.isNaN(extraidoLimpio)) {
        return extraidoLimpio;
    }
    if (typeof data.price === 'number') {
        return data.price;
    }
    const match = String(data.price || '').match(/[\d,]+\.\d{2}/);
    return match ? parseFloat(match[0].replace(/,/g, '')) : NaN;
};

const extraerPrecioTexto = (precioBruto) => {
    if (typeof precioBruto === 'number') return precioBruto;
    const match = String(precioBruto || '').match(/[\d,]+\.\d{2}/);
    return match ? parseFloat(match[0].replace(/,/g, '')) : NaN;
};

// 1. Amazon vía Scrapingdog (Amazon Product Scraper API)
//    originalId debe ser el ASIN real del producto (ej: B08N5WRWNW)
const obtenerProductoAmazon = async (asin) => {
    const params = new URLSearchParams({
        api_key: process.env.SCRAPINGDOG_API_KEY,
        domain: 'com',
        asin
    });

    const response = await fetchConReintento(`https://api.scrapingdog.com/amazon/product?${params.toString()}`);

    if (!response.ok) {
        throw new Error(`Scrapingdog respondió ${response.status}`);
    }

    const data = await response.json();

    const precioNumerico = extraerPrecioAmazon(data);

    return {
        originalId: asin,
        source: 'amazon',
        title: data.title,
        price: precioNumerico,
        currency: 'USD',
        images: data.images || data.images_of_specified_asin || []
    };
};

// 2. Shein vía Omkar Cloud (API dedicada a Shein, con lookup exacto por producto)
//    originalId debe ser la URL completa del producto en Shein (o su goods_id numérico)
const obtenerProductoShein = async (productUrl) => {
    const params = new URLSearchParams({ product: productUrl });

    const response = await fetchConReintento(`https://shein-scraper.omkar.cloud/shein/products/details?${params.toString()}`, {
        headers: { 'API-Key': process.env.OMKAR_SHEIN_API_KEY }
    }, 2, 70000);

    if (!response.ok) {
        throw new Error(`Omkar Cloud (Shein) respondió ${response.status}`);
    }

    const data = await response.json();

    return {
        originalId: productUrl,
        source: 'shein',
        title: data.name,
        price: data.pricing?.sale_price?.amount,
        currency: 'USD',
        images: data.images || [],
        sizes: (data.sizes || [])
            .filter(s => s.size)
            .map(s => ({ size: s.size, inStock: s.in_stock !== false })),
        colors: (data.colors || [])
            .filter(c => c.name && c.link)
            .map(c => ({ name: c.name, link: c.link, image: c.image || '', current: c.goods_id === data.goods_id }))
    };
};

// 3. Búsqueda por PALABRA CLAVE en Amazon (Scrapingdog Amazon Search API)
//    Devuelve una lista liviana de candidatos, sin cachear todavía.
// Orden elegido en la UI -> orden que se le pide a Shein (Omkar). El resto (precio por
// pieza, valoracion) se aplica aqui mismo sobre los resultados ya traidos.
// Convierte conteos de resenas que a veces llegan como texto ("12.7K", "1,234", "2M") a numero.
const parsearConteo = (v) => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    const m = String(v || '').replace(/,/g, '').match(/([\d.]+)\s*([kKmM])?/);
    if (!m) return 0;
    const n = parseFloat(m[1]);
    if (!Number.isFinite(n)) return 0;
    const mult = { k: 1e3, m: 1e6 }[(m[2] || '').toLowerCase()] || 1;
    return Math.round(n * mult);
};
const ORDENES = ['cheapest', 'unit', 'popular', 'rated', 'relevance'];
const ORDEN_SHEIN = {
    cheapest: 'price_low_to_high',
    unit: 'price_low_to_high',
    popular: 'most_popular',
    rated: 'most_popular',
    relevance: 'recommend'
};
const MAX_PAGINAS = 4;
// Tope de paginas que el cliente puede cargar con "Cargar mas": evita acumular cientos de
// tarjetas en el celular y limita los creditos gastados por una sola busqueda.
const MAX_PAGINAS_CARGA = 4;

// Cache corto en memoria de lo que devuelve el proveedor (datos publicos, iguales para todos).
// Repetir la misma busqueda, o cambiar entre ordenes que piden lo mismo al proveedor, ya no
// gasta otra llamada. Se vacia solo al reiniciar el servidor.
const CACHE_BUSQUEDA_MS = 10 * 60 * 1000;
const CACHE_BUSQUEDA_MAX = 200;
const cacheBusqueda = new Map();
const leerCache = (clave) => {
    const hit = cacheBusqueda.get(clave);
    if (!hit) return null;
    if (hit.expira < Date.now()) { cacheBusqueda.delete(clave); return null; }
    return hit.valor;
};
const guardarCache = (clave, valor) => {
    if (cacheBusqueda.size >= CACHE_BUSQUEDA_MAX) cacheBusqueda.delete(cacheBusqueda.keys().next().value);
    cacheBusqueda.set(clave, { valor, expira: Date.now() + CACHE_BUSQUEDA_MS });
};

// 3. Busqueda por PALABRA CLAVE en Amazon (Scrapingdog Amazon Search API).
//    Una llamada trae ~48 productos (mismo costo que antes, cuando solo usabamos 12).
const buscarPorTextoAmazon = async (query, { page = 1 } = {}) => {
    const params = new URLSearchParams({
        api_key: process.env.SCRAPINGDOG_API_KEY,
        domain: 'com',
        query,
        page: String(page)
    });

    const response = await fetchConReintento(`https://api.scrapingdog.com/amazon/search?${params.toString()}`);
    if (!response.ok) {
        throw new Error(`Scrapingdog respondió ${response.status}`);
    }
    const data = await response.json();
    const items = data.results || [];

    // Solo mapeamos campos concretos: la respuesta cruda de Scrapingdog trae enlaces con la API key.
    const resultados = items
        .filter(item => item.asin && !item.sponsored && (item.extracted_price || item.price))
        .map(item => {
            const price = item.extracted_price ?? extraerPrecioTexto(item.price);
            const viejo = item.extracted_old_price;
            return {
                originalId: item.asin,
                source: 'amazon',
                title: item.title,
                price,
                image: item.image,
                rating: typeof item.rating === 'number' ? item.rating : (parseFloat(item.stars) || 0),
                reviews: parsearConteo(item.reviews ?? item.total_reviews),
                discountPercent: viejo && viejo > price ? Math.round((1 - price / viejo) * 100) : 0,
                category: '',
                badge: item.is_best_seller ? 'Más vendido' : (item.is_amazon_choice ? "Amazon's Choice" : '')
            };
        })
        .filter(r => Number.isFinite(r.price) && r.price > 0);

    return { resultados, hayMas: items.length >= 20 && page < MAX_PAGINAS_CARGA, totalPaginas: null, total: null };
};

// 4. Busqueda por PALABRA CLAVE en Shein (Omkar Cloud, mismo proveedor que el detalle).
//    Una llamada trae hasta 120 productos y acepta orden y rango de precio nativos.
const buscarPorTextoShein = async (query, { sort = 'recommend', minPrecio = null, maxPrecio = null, page = 1 } = {}) => {
    const params = new URLSearchParams({ query, country: 'US', sort, page: String(page) });
    if (minPrecio) params.set('min_price', String(minPrecio));
    if (maxPrecio) params.set('max_price', String(maxPrecio));

    const response = await fetchConReintento(`https://shein-scraper.omkar.cloud/shein/search/products?${params.toString()}`, {
        headers: { 'API-Key': process.env.OMKAR_SHEIN_API_KEY }
    }, 2, 70000);
    if (!response.ok) {
        throw new Error(`Omkar Cloud (Shein) respondió ${response.status}`);
    }
    const data = await response.json();
    const items = data.results || [];

    const resultados = items
        .filter(item => item.link && item.pricing?.sale_price?.amount && item.in_stock !== false)
        .map(item => ({
            originalId: item.link,
            source: 'shein',
            title: item.name,
            price: item.pricing.sale_price.amount,
            image: item.image,
            rating: item.rating || 0,
            reviews: parsearConteo(item.reviews_count),
            discountPercent: item.pricing.discount_percent || 0,
            category: item.category?.name || '',
            badge: ''
        }));

    const totalPaginas = Math.min(data.total_pages || 1, MAX_PAGINAS);
    return { resultados, hayMas: page < Math.min(totalPaginas, MAX_PAGINAS_CARGA), totalPaginas, total: data.count ?? null };
};

// Completa cada resultado con lo que ve el cliente: precio con margen, piezas del set y
// precio por pieza. A proposito NO devolvemos el precio de origen (oculta el margen).
const enriquecer = (r) => {
    const { piezas, esSet } = detectarPaquete(r.title);
    const precioFinalCliente = calcularPrecioFinal(r.price);
    return {
        originalId: r.originalId,
        source: r.source,
        title: r.title,
        image: r.image,
        rating: r.rating || 0,
        reviews: r.reviews || 0,
        discountPercent: r.discountPercent || 0,
        category: r.category || '',
        badge: r.badge || '',
        piezas,
        esSet,
        precioFinalCliente,
        precioUnidadCliente: parseFloat((precioFinalCliente / piezas).toFixed(2)),
        cantidadDesconocida: esSet && piezas === 1
    };
};

const ordenar = (lista, orden) => {
    const porPrecio = (a, b) => a.precioFinalCliente - b.precioFinalCliente;
    if (orden === 'cheapest') return [...lista].sort(porPrecio);
    if (orden === 'unit') return [...lista].sort((a, b) => (Number(a.cantidadDesconocida) - Number(b.cantidadDesconocida)) || (a.precioUnidadCliente - b.precioUnidadCliente) || porPrecio(a, b));
    if (orden === 'rated') return [...lista].sort((a, b) => (b.rating - a.rating) || (b.reviews - a.reviews));
    return lista; // popular / relevance: se respeta el orden que trae la tienda
};

const aPrecio = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
};
// ------------------------------------

// Búsqueda EXACTA (por ASIN o URL) — la que ya existía, usada al agregar al carrito
const searchProduct = async (req, res) => {
    try {
        const { originalId, source } = req.body;

        if (!originalId || !source) {
            return res.status(400).json({ error: 'Se requiere originalId y source' });
        }

        let producto = await ProductCache.findOne({ originalId, source });

        if (producto) {
            console.log(`⚡ Producto desde Caché (${source.toUpperCase()}). Aplicando reglas de precio...`);
            const productoResponse = producto.toObject();
            productoResponse.precioFinalCliente = calcularPrecioFinal(producto.price);
            return res.json({ mensaje: 'Recuperado desde Caché', data: productoResponse });
        }

        console.log(`🐌 Consumiendo API externa para ${source.toUpperCase()}...`);

        let externalApiData;

        if (source === 'amazon') {
            externalApiData = await obtenerProductoAmazon(originalId);
        } else if (source === 'shein') {
            externalApiData = await obtenerProductoShein(originalId);
        } else {
            return res.status(400).json({ error: 'Fuente no soportada. Usa "amazon" o "shein".' });
        }

        if (!externalApiData.title || !externalApiData.price) {
            return res.status(502).json({ error: `No se pudo extraer el producto desde ${source.toUpperCase()}. Verifica el ID/URL.` });
        }

        producto = new ProductCache(externalApiData);
        try {
            await producto.save();
        } catch (error) {
            if (error.code === 11000) {
                // Dos búsquedas casi simultáneas del mismo producto: la otra ya ganó la carrera
                producto = await ProductCache.findOne({ originalId, source });
            } else {
                throw error;
            }
        }

        const productoResponse = producto.toObject();
        productoResponse.precioFinalCliente = calcularPrecioFinal(producto.price);

        return res.json({
            mensaje: `Extraído de ${source.toUpperCase()} y guardado en caché`,
            data: productoResponse
        });

    } catch (error) {
        console.error('❌ Error en el motor de búsqueda:', error.message);
        // Si falló el proveedor externo (Scrapingdog/Omkar Cloud caído o lento), le
        // mostramos al cliente un mensaje claro en vez de un genérico "error interno".
        const esProveedorExterno = /Scrapingdog respondió|Omkar Cloud|no respondió a tiempo/.test(error.message);
        res.status(esProveedorExterno ? 502 : 500).json({
            error: esProveedorExterno ? error.message : 'Error interno del servidor'
        });
    }
};

// Búsqueda por PALABRA CLAVE — nueva, para cuando el cliente no tiene un link/ASIN
const searchByKeyword = async (req, res) => {
    try {
        const { query, source } = req.body;

        if (!query || !source) {
            return res.status(400).json({ error: 'Se requiere query y source' });
        }
        if (source !== 'amazon' && source !== 'shein') {
            return res.status(400).json({ error: 'Fuente no soportada. Usa "amazon" o "shein".' });
        }

        // Filtros opcionales. Los precios que manda el cliente son los que EL ve (con margen).
        const orden = ORDENES.includes(req.body.sort) ? req.body.sort : 'cheapest';
        const page = Math.min(Math.max(parseInt(req.body.page, 10) || 1, 1), MAX_PAGINAS);
        const minCliente = aPrecio(req.body.minPrice);
        const maxCliente = aPrecio(req.body.maxPrice);
        if (minCliente && maxCliente && minCliente > maxCliente) {
            return res.status(400).json({ error: 'El precio mínimo no puede ser mayor que el máximo' });
        }

        // Traducimos el rango del cliente a precio de origen para que Shein filtre de su lado.
        // Shein solo acepta enteros. El maximo se redondea hacia arriba (holgado) y abajo se
        // recorta exacto con el precio final. El minimo, cuando se ordena por precio ascendente,
        // tambien hacia arriba: si no, la primera pagina se llena de productos justo por debajo
        // del minimo y quedaria vacia tras el recorte.
        const ascendente = ORDEN_SHEIN[orden] === 'price_low_to_high';
        const minExacto = minCliente ? precioOrigenDesdeFinal(minCliente) : null;
        const minOrigen = minExacto ? (ascendente ? Math.ceil(minExacto) : Math.floor(minExacto)) : null;
        const maxOrigen = maxCliente ? Math.ceil(precioOrigenDesdeFinal(maxCliente)) : null;

        const texto = String(query).trim().toLowerCase();
        const claveCache = source === 'amazon'
            ? `amazon|${texto}|${page}`
            : `shein|${texto}|${ORDEN_SHEIN[orden]}|${minOrigen || ''}|${maxOrigen || ''}|${page}`;
        let busqueda = leerCache(claveCache);
        if (!busqueda) {
            busqueda = source === 'amazon'
                ? await buscarPorTextoAmazon(query, { page })
                : await buscarPorTextoShein(query, { sort: ORDEN_SHEIN[orden], minPrecio: minOrigen, maxPrecio: maxOrigen, page });
            guardarCache(claveCache, busqueda);
        }

        // El precio real y definitivo se recalcula server-side al hacer /api/search + /api/carrito.
        let resultados = busqueda.resultados.map((r, i) => ({ ...enriquecer(r), posicion: (page - 1) * 1000 + i }));
        if (minCliente) resultados = resultados.filter(r => r.precioFinalCliente >= minCliente);
        if (maxCliente) resultados = resultados.filter(r => r.precioFinalCliente <= maxCliente);
        resultados = ordenar(resultados, orden);

        res.json({
            resultados,
            orden,
            pagina: page,
            hayMas: busqueda.hayMas,
            totalPaginas: busqueda.totalPaginas,
            total: busqueda.total
        });
    } catch (error) {
        console.error('❌ Error en la búsqueda por texto:', error.message);
        const esProveedorExterno = /Scrapingdog respondió|Omkar Cloud|no respondió a tiempo/.test(error.message);
        res.status(esProveedorExterno ? 502 : 500).json({
            error: esProveedorExterno ? error.message : 'Error interno al buscar productos'
        });
    }
};
module.exports = { searchProduct, searchByKeyword, obtenerProductoAmazon, obtenerProductoShein };
