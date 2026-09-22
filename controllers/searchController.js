const ProductCache = require('../models/ProductCache');
const { calcularPrecioFinal } = require('../utils/pricing');

// --- CONEXIÓN CON APIs EXTERNAS REALES ---

// 1. Amazon vía Scrapingdog (Amazon Product Scraper API)
//    originalId debe ser el ASIN real del producto (ej: B08N5WRWNW)
const obtenerProductoAmazon = async (asin) => {
    const params = new URLSearchParams({
        api_key: process.env.SCRAPINGDOG_API_KEY,
        domain: 'com',
        asin
    });

    const response = await fetch(`https://api.scrapingdog.com/amazon/product?${params.toString()}`);

    if (!response.ok) {
        throw new Error(`Scrapingdog respondió ${response.status}`);
    }

    const data = await response.json();

    const precioNumerico = typeof data.price === 'number'
        ? data.price
        : parseFloat(String(data.price).replace(/[^0-9.]/g, ''));

    return {
        originalId: asin,
        source: 'amazon',
        title: data.title,
        price: precioNumerico,
        currency: 'USD',
        images: data.images || data.images_of_specified_asin || []
    };
};

// 2. Shein vía Apify (actor: shahidirfan/shein-product-scraper)
//    originalId debe ser la URL completa del producto en Shein
const obtenerProductoShein = async (productUrl) => {
    const url = `https://api.apify.com/v2/acts/shahidirfan~shein-product-scraper/run-sync-get-dataset-items?token=${process.env.APIFY_API_TOKEN}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            startUrl: productUrl,
            results_wanted: 1
        })
    });

    if (!response.ok) {
        throw new Error(`Apify respondió ${response.status}`);
    }

    const items = await response.json();
    const producto = items[0];

    if (!producto) {
        throw new Error('Shein no devolvió ningún producto para esa URL');
    }

    return {
        originalId: productUrl,
        source: 'shein',
        title: producto.title,
        price: producto.sale_price,
        currency: 'USD',
        images: [producto.image_url, ...(producto.detail_image || [])].filter(Boolean)
    };
};

// 3. Búsqueda por PALABRA CLAVE en Amazon (Scrapingdog Amazon Search API)
//    Devuelve una lista liviana de candidatos, sin cachear todavía.
const buscarPorTextoAmazon = async (query) => {
    const params = new URLSearchParams({
        api_key: process.env.SCRAPINGDOG_API_KEY,
        domain: 'com',
        query,
        page: '1'
    });

    const response = await fetch(`https://api.scrapingdog.com/amazon/search?${params.toString()}`);
    if (!response.ok) {
        throw new Error(`Scrapingdog respondió ${response.status}`);
    }
    const data = await response.json();
    const items = data.results || [];

    return items
        .filter(item => item.asin && (item.extracted_price || item.price))
        .slice(0, 12)
        .map(item => ({
            originalId: item.asin,
            source: 'amazon',
            title: item.title,
            price: item.extracted_price ?? parseFloat(String(item.price).replace(/[^0-9.]/g, '')),
            image: item.image
        }));
};

// 4. Búsqueda por PALABRA CLAVE en Shein (mismo actor de Apify, con URL de búsqueda)
const buscarPorTextoShein = async (query) => {
    const searchUrl = `https://us.shein.com/pdsearch/${encodeURIComponent(query)}/`;
    const url = `https://api.apify.com/v2/acts/shahidirfan~shein-product-scraper/run-sync-get-dataset-items?token=${process.env.APIFY_API_TOKEN}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            startUrl: searchUrl,
            results_wanted: 12
        })
    });
    if (!response.ok) {
        throw new Error(`Apify respondió ${response.status}`);
    }
    const items = await response.json();

    return items
        .filter(item => item.url && item.sale_price)
        .map(item => ({
            originalId: item.url,
            source: 'shein',
            title: item.title,
            price: item.sale_price,
            image: item.image_url
        }));
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
        await producto.save();

        const productoResponse = producto.toObject();
        productoResponse.precioFinalCliente = calcularPrecioFinal(producto.price);

        return res.json({
            mensaje: `Extraído de ${source.toUpperCase()} y guardado en caché`,
            data: productoResponse
        });

    } catch (error) {
        console.error('❌ Error en el motor de búsqueda:', error.message);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
};

// Búsqueda por PALABRA CLAVE — nueva, para cuando el cliente no tiene un link/ASIN
const searchByKeyword = async (req, res) => {
    try {
        const { query, source } = req.body;

        if (!query || !source) {
            return res.status(400).json({ error: 'Se requiere query y source' });
        }

        let resultados;
        if (source === 'amazon') {
            resultados = await buscarPorTextoAmazon(query);
        } else if (source === 'shein') {
            resultados = await buscarPorTextoShein(query);
        } else {
            return res.status(400).json({ error: 'Fuente no soportada. Usa "amazon" o "shein".' });
        }

        // Le aplicamos el margen a cada resultado solo para MOSTRAR el precio al cliente.
        // El precio real y definitivo se recalcula server-side al hacer /api/search + /api/carrito.
        const conMargen = resultados.map(r => ({
            ...r,
            precioFinalCliente: calcularPrecioFinal(r.price)
        }));

        res.json({ resultados: conMargen });
    } catch (error) {
        console.error('❌ Error en la búsqueda por texto:', error.message);
        res.status(500).json({ error: 'Error interno al buscar productos' });
    }
};

module.exports = { searchProduct, searchByKeyword };
