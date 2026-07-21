/**
 * aplicar-coordenadas-osm.js
 *
 * Lee el reporte de geocodificación (reporte-geocodificacion.json) y la caché (cache-geocodificacion.json)
 * y actualiza las coordenadas (lat, lng) en buildings.json para todos los edificios con estado 'ok'
 * (distancia <= umbral, por defecto 200 m).
 *
 * Uso:
 *   node tools/aplicar-coordenadas-osm.js [--dry-run] [--umbral-m 150] [--aplicar]
 *
 * Opciones:
 *   --dry-run      Muestra el listado de cambios propuestos sin modificar buildings.json.
 *   --aplicar      Crea un respaldo buildings.backup-<fecha>.json y aplica las coordenadas OSM.
 *   --umbral-m N   Umbral máximo en metros para considerar una coincidencia aceptable (por defecto: 200).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BUILDINGS_FILE = path.join(ROOT, 'buildings.json');
const REPORT_FILE = path.join(__dirname, 'reporte-geocodificacion.json');
const CACHE_FILE = path.join(__dirname, 'cache-geocodificacion.json');

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run') || !args.includes('--aplicar');
const umbralIndex = args.indexOf('--umbral-m');
const maxUmbral = umbralIndex >= 0 ? parseFloat(args[umbralIndex + 1]) : 200;

if (!fs.existsSync(BUILDINGS_FILE)) {
    console.error('ERROR: No se encontró buildings.json');
    process.exit(1);
}

if (!fs.existsSync(REPORT_FILE) || !fs.existsSync(CACHE_FILE)) {
    console.error('ERROR: Se requiere reporte-geocodificacion.json y cache-geocodificacion.json.');
    console.error('Ejecute primero: node tools/verificar-edificios.js');
    process.exit(1);
}

const buildings = JSON.parse(fs.readFileSync(BUILDINGS_FILE, 'utf8'));
const reporte = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8'));
const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));

console.log(`\n=== Aplicador de Coordenadas Confirmadas por OpenStreetMap (OSM) ===`);
console.log(`Cargados ${buildings.length} edificios en catalog.`);
console.log(`Umbral máximo de distancia: ${maxUmbral} m\n`);

let actualizados = 0;
const cambios = [];

reporte.resultados.forEach(item => {
    if (item.estado !== 'ok') return;
    if (item.distancia_m == null || item.distancia_m > maxUmbral) return;
    if (!item.consulta || !cache[item.consulta] || cache[item.consulta].error) return;

    const osmData = cache[item.consulta];
    const b = buildings[item.indice];

    if (!b) return;

    // Verificar diferencia real en coordenadas
    const oldLat = b.lat;
    const oldLng = b.lng;
    const newLat = parseFloat(osmData.lat.toFixed(6));
    const newLng = parseFloat(osmData.lng.toFixed(6));

    if (Math.abs(oldLat - newLat) > 0.000001 || Math.abs(oldLng - newLng) > 0.000001) {
        actualizados++;
        cambios.push({
            indice: item.indice,
            nombre: b.name,
            oldPos: `${oldLat.toFixed(5)}, ${oldLng.toFixed(5)}`,
            newPos: `${newLat.toFixed(5)}, ${newLng.toFixed(5)}`,
            distancia_m: item.distancia_m,
            newLat,
            newLng
        });
    }
});

console.log(`Edificios listos para actualizar coordenadas: ${actualizados} de ${reporte.resumen.ok} confirmados.\n`);

if (cambios.length > 0) {
    console.log('Muestra de actualizaciones de coordenadas:');
    cambios.slice(0, 15).forEach((c, idx) => {
        console.log(`  ${idx + 1}. [${c.indice}] ${c.nombre}`);
        console.log(`     Antigua: (${c.oldPos})  ->  Nueva OSM: (${c.newPos})  [d = ${c.distancia_m} m]`);
    });
    if (cambios.length > 15) {
        console.log(`  ... y ${cambios.length - 15} edificios más.`);
    }
}

if (isDryRun) {
    console.log('\n------------------------------------------------------------------');
    console.log('MODO SIMULACIÓN (DRY RUN) — No se realizaron cambios en buildings.json.');
    console.log('Para aplicar los cambios reales y generar respaldo, ejecute:');
    console.log('  node tools/aplicar-coordenadas-osm.js --aplicar');
    console.log('------------------------------------------------------------------\n');
} else {
    // 1. Crear respaldo
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath = path.join(ROOT, `buildings.backup-${stamp}.json`);
    fs.copyFileSync(BUILDINGS_FILE, backupPath);
    console.log(`\nRespaldo creado: ${path.basename(backupPath)}`);

    // 2. Aplicar cambios a buildings.json
    cambios.forEach(c => {
        buildings[c.indice].lat = c.newLat;
        buildings[c.indice].lng = c.newLng;
    });

    fs.writeFileSync(BUILDINGS_FILE, JSON.stringify(buildings, null, 4) + '\n', 'utf8');
    console.log(`buildings.json actualizado exitosamente con ${cambios.length} coordenadas precisas de OSM. ✔\n`);
}
