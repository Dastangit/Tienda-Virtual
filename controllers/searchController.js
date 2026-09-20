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

    // El precio a veces viene como string ("$25.00") y a veces como número
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
// ------------------------------------

const searchProduct = async (req, res) => {
    try {
        const { originalId, source } = req.body;

        if (!originalId || !source) {
            return res.status(400).json({ error: 'Se requiere originalId y source' });
        }

        // Buscamos primero en el caché
        let producto = await ProductCache.findOne({ originalId, source });

        if (producto) {
            console.log(`⚡ Producto desde Caché (${source.toUpperCase()}). Aplicando reglas de precio...`);
            const productoResponse = producto.toObject();
            productoResponse.precioFinalCliente = calcularPrecioFinal(producto.price);
            return res.json({ mensaje: 'Recuperado desde Caché', data: productoResponse });
        }

        console.log(`🐌 Consumiendo API externa para ${source.toUpperCase()}...`);

        let externalApiData;

        // 🔀 BIFURCACIÓN LÓGICA SEGÚN LA FUENTE
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

        // Guardamos la información específica en la base de datos
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

module.exports = { searchProduct };
