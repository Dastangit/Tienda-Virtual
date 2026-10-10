// Copia de seguridad de la base de datos: exporta cada coleccion a un archivo JSON
// dentro de backups/AAAA-MM-DD_HHMM/. Uso:  node scripts/backup-db.js
// OJO: la copia incluye telefonos y hashes de contrasena. La carpeta backups/ esta en
// .gitignore: no la subas a GitHub ni la compartas.
require('dotenv').config({ path: __dirname + '/../.env' });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { EJSON } = mongoose.mongo.BSON;

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  const dir = path.join(__dirname, '..', 'backups', stamp);
  fs.mkdirSync(dir, { recursive: true });

  const colecciones = await mongoose.connection.db.listCollections().toArray();
  const resumen = {};
  for (const { name } of colecciones) {
    const docs = await mongoose.connection.db.collection(name).find({}).toArray();
    // EJSON conserva ObjectId y fechas, para poder restaurar sin perder tipos
    fs.writeFileSync(path.join(dir, `${name}.json`), EJSON.stringify(docs, { relaxed: false }, 2));
    resumen[name] = docs.length;
  }
  fs.writeFileSync(path.join(dir, '_resumen.json'), JSON.stringify({ fecha: d.toISOString(), documentos: resumen }, null, 2));

  console.log('Copia guardada en:', dir);
  console.table(resumen);
  await mongoose.disconnect();
})().catch(e => { console.error('ERROR en la copia:', e.message); process.exit(1); });