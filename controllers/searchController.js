const ProductCache = require('../models/ProductCache');
const { calcularPrecioFinal } = require('../utils/pricing');

// --- CONEXIÓN CON APIs EXTERNAS REALES ---

// fetch nativo de Node a veces falla con "fetch failed" por un hipo de red
// transitorio (común en Windows / detrás de VPN), sin que la API externa
// tenga la culpa. Un reintento simple resuelve la gran mayoría de estos casos.
const fetchConReintento = async (url, options, intentos = 2) => {
    for (let intento = 1; intento <= intentos; intento++) {
        try {
            return await fetch(url, options);
        } catch (error) {
            const esUltimoIntento = intento === intentos;
            console.error(`⚠️ fetch falló (intento ${intento}/${intentos}): ${error.message}`);
            if (esUltimoIntento) throw error;
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
    });

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
        images: data.images || []
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

    const response = await fetchConReintento(`https://api.scrapingdog.com/amazon/search?${params.toString()}`);
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
            price: item.extracted_price ?? extraerPrecioTexto(item.price),
            image: item.image
        }));
};

// 4. Búsqueda por PALABRA CLAVE en Shein (Omkar Cloud, mismo proveedor que el detalle)
const buscarPorTextoShein = async (query) => {
    const params = new URLSearchParams({ query, country: 'US' });

    const response = await fetchConReintento(`https://shein-scraper.omkar.cloud/shein/search/products?${params.toString()}`, {
        headers: { 'API-Key': process.env.OMKAR_SHEIN_API_KEY }
    });
    if (!response.ok) {
        throw new Error(`Omkar Cloud (Shein) respondió ${response.status}`);
    }
    const data = await response.json();
    const items = data.results || [];

    return items
        .filter(item => item.link && item.pricing?.sale_price?.amount)
        .slice(0, 12)
        .map(item => ({
            originalId: item.link,
            source: 'shein',
            title: item.name,
            price: item.pricing.sale_price.amount,
            image: item.image
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
