// Detecta, a partir del titulo, si un producto se vende como set / paquete de varias
// piezas ("3pcs", "Set of 5", "10 Pack", "2-Piece Set", "Pack de 12") y cuantas trae.
// Sirve para mostrar "Set x5" y el precio por pieza, y para filtrar por cantidad.
const UNIDADES = '(?:pcs?|pieces?|pack|packs|pairs?|prs?|sets?|units?|count|ct|rolls?|bags?|boxes|pieza|piezas|paquetes?|uds?|unidades?|pzas?|pares?|par|juegos?|conjuntos?|rollos?|bolsas?|cajas?)';

const PATRONES = [
    new RegExp('\\b(?:set|pack|lot|bundle|kit)\\s+of\\s+(\\d{1,3})\\b', 'i'),     // "Set of 5"
    new RegExp('\\b(\\d{1,3})\\s*-?\\s*' + UNIDADES + '\\b', 'i'),                 // "5pcs", "5-Piece", "10 Pack"
    new RegExp('\\b(?:pack|set|lote|paquete|conjunto|juego|kit)\\s+(?:de\\s+)?(\\d{1,3})\\b', 'i')    // "Pack de 12"
];

// Titulos que dicen "set / kit / combo" sin indicar cantidad: cuentan como set (piezas = 1).
const PALABRAS_SET = /\b(sets?|bundle|combo|kit|multi-?pack|juegos?|paquetes?|lotes?)\b/i;

const detectarPaquete = (titulo) => {
    const texto = String(titulo || '');
    let mejor = null;
    for (const patron of PATRONES) {
        const m = patron.exec(texto);
        if (!m) continue;
        const n = parseInt(m[1], 10);
        if (n < 2 || n > 500) continue;
        if (!mejor || m.index < mejor.index) mejor = { n, index: m.index };
    }
    const piezas = mejor ? mejor.n : 1;
    return { piezas, esSet: piezas > 1 || PALABRAS_SET.test(texto) };
};

module.exports = { detectarPaquete };