// Busca clientes con MAS DE UN carrito "activo" (pasaba con doble clic antes del indice unico).
// Mientras existan, MongoDB no puede crear el indice nuevo de models/Cart.js.
//   node scripts/revisar-carritos-duplicados.js            -> solo muestra los casos
//   node scripts/revisar-carritos-duplicados.js --arreglar -> une los productos en el carrito mas
//                                                            reciente y borra los demas (si son de
//                                                            la misma tienda; si no, solo avisa)
// Haz una copia antes (node scripts/backup-db.js).
require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');
const Cart = require('../models/Cart');

const arreglar = process.argv.includes('--arreglar');

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    const grupos = await Cart.aggregate([
        { $match: { status: 'activo' } },
        { $group: { _id: '$user', carritos: { $push: '$_id' }, total: { $sum: 1 } } },
        { $match: { total: { $gt: 1 } } }
    ]);

    if (grupos.length === 0) {
        console.log('Todo bien: ningún cliente tiene más de un carrito activo.');
    }

    for (const g of grupos) {
        const carritos = await Cart.find({ _id: { $in: g.carritos } }).sort({ updatedAt: -1 });
        const fuentes = new Set(carritos.flatMap(c => c.items.map(i => i.source)));
        console.log(`Cliente ${g._id}: ${carritos.length} carritos activos (${carritos.map(c => c.items.length + ' productos').join(', ')})`);

        if (!arreglar) continue;
        if (fuentes.size > 1) {
            console.log('   ⚠️ Mezclan Amazon y Shein: revísalo a mano en Atlas.');
            continue;
        }
        const [principal, ...sobrantes] = carritos;
        sobrantes.forEach(c => principal.items.push(...c.items.map(i => i.toObject())));
        await principal.save();
        await Cart.deleteMany({ _id: { $in: sobrantes.map(c => c._id) } });
        console.log(`   ✅ Unidos en ${principal._id}`);
    }

    if (arreglar) {
        await Cart.createIndexes();
        console.log('Índice de carrito activo único creado.');
    }
    await mongoose.disconnect();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
