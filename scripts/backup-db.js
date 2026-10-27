// Copia de seguridad de la base de datos: exporta cada coleccion a un archivo JSON
// dentro de backups/AAAA-MM-DD_HHMM/. Uso:  npm run backup  (o node scripts/backup-db.js)
// Guarda las 8 copias mas recientes y borra las anteriores.
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

  // Rotacion: solo se guardan las COPIAS_A_GUARDAR mas recientes (los nombres AAAA-MM-DD_HHMM
  // se ordenan solos por fecha), para que la carpeta no crezca sin limite con la copia automatica.
  const COPIAS_A_GUARDAR = 8;
  const raiz = path.join(__dirname, '..', 'backups');
  const copias = fs.readdirSync(raiz).filter(n => /^\d{4}-\d{2}-\d{2}_\d{4}$/.test(n)).sort();
  for (const vieja of copias.slice(0, -COPIAS_A_GUARDAR)) {
    fs.rmSync(path.join(raiz, vieja), { recursive: true, force: true });
    console.log('Copia vieja borrada:', vieja);
  }
  await mongoose.disconnect();
})().catch(e => { console.error('ERROR en la copia:', e.message); process.exit(1); });