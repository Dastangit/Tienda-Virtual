// Regla de negocio única y centralizada: margen de ganancia del Proxy Shopping.
// Cualquier lugar del código que necesite calcular el precio final del cliente
// debe importar esta función en vez de reescribir la fórmula.
const MARGEN_PROXY = 0.20;

const calcularPrecioFinal = (precioOriginal) => {
    const ganancia = precioOriginal * MARGEN_PROXY;
    return parseFloat((precioOriginal + ganancia).toFixed(2));
};

// Inverso de calcularPrecioFinal: dado el precio que ve el cliente, devuelve el precio de
// origen equivalente. Sirve para traducir los filtros de precio del cliente a la tienda.
const precioOrigenDesdeFinal = (precioFinal) => precioFinal / (1 + MARGEN_PROXY);

module.exports = { calcularPrecioFinal, precioOrigenDesdeFinal, MARGEN_PROXY };
