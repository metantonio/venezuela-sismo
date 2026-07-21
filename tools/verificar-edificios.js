/**
 * verificar-edificios.js — Verificación de buildings.json
 *
 * Dos funciones:
 *   1) GEOCODIFICACIÓN: contrasta las coordenadas (lat/lng) de cada edificio con
 *      el servicio Nominatim (OpenStreetMap), consultando nombre + dirección +
 *      Venezuela. Los resultados se cachean en tools/cache-geocodificacion.json,
 *      de modo que las corridas siguientes solo consultan los edificios NUEVOS.
 *   2) DUPLICADOS: detecta grupos de edificios duplicados (mismo nombre o casi el
 *      mismo + misma dirección o mismas coordenadas) y permite revisarlos caso a
 *      caso para decidir cuáles conservar. Antes de escribir buildings.json crea
 *      una copia de respaldo buildings.backup-<fecha>.json.
 *
 * Uso:
 *   node tools/verificar-edificios.js [opciones]
 *
 * Opciones:
 *   --no-geocode        Omite la verificación en línea (solo duplicados).
 *   --limit N           Geocodifica como máximo N edificios (para pruebas).
 *   --umbral-m N        Distancia en m para marcar discrepancia (por defecto 200).
 *   --solo-reporte      Duplicados: solo listar grupos, sin preguntas ni cambios.
 *   --auto-keep-first   Duplicados: conserva el 1.º de cada grupo y elimina el
 *                       resto SIN preguntar (crea respaldo igualmente).
 *
 * Nota: Nominatim exige máximo 1 petición/segundo y un User-Agent identificable
 * (https://operations.osmfoundation.org/policies/nominatim/). Este script cumple
 * ambas. Requiere Node.js >= 18 (fetch global).
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'buildings.json');
const CACHE_FILE = path.join(__dirname, 'cache-geocodificacion.json');
const REPORT_FILE = path.join(__dirname, 'reporte-geocodificacion.json');

const args = process.argv.slice(2);
const OPT = {
    geocode: !args.includes('--no-geocode'),
    limit: (() => { const i = args.indexOf('--limit'); return i >= 0 ? parseInt(args[i + 1], 10) : Infinity; })(),
    umbral: (() => { const i = args.indexOf('--umbral-m'); return i >= 0 ? parseFloat(args[i + 1]) : 200; })(),
    soloReporte: args.includes('--solo-reporte'),
    autoKeepFirst: args.includes('--auto-keep-first')
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Utilidades de texto y distancia
// ---------------------------------------------------------------------------
function norm(s) {
    return (s || '').toLowerCase().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')     // sin tildes
        .replace(/[^a-z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ').trim();
}

function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
        const cur = [i];
        for (let j = 1; j <= n; j++) {
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        prev = cur;
    }
    return prev[n];
}
const levSim = (a, b) => 1 - lev(a, b) / Math.max(a.length, b.length, 1);

function jaccard(a, b) {
    const A = new Set(a.split(' ').filter(Boolean)), B = new Set(b.split(' ').filter(Boolean));
    if (!A.size || !B.size) return 0;
    let inter = 0;
    A.forEach(t => { if (B.has(t)) inter++; });
    return inter / (A.size + B.size - inter);
}

// Distancia equirectangular en metros (suficiente a escala urbana)
function distM(a, b) {
    const dx = (a.lng - b.lng) * 111320 * Math.cos(a.lat * Math.PI / 180);
    const dz = (a.lat - b.lat) * 110540;
    return Math.sqrt(dx * dx + dz * dz);
}

// Palabras genéricas que no distinguen un edificio de otro
const STOP = new Set(['edificio', 'edif', 'residencias', 'residencia', 'res', 'torre',
    'conjunto', 'residencial', 'urb', 'urbanizacion', 'apartamentos', 'apto',
    'complejo', 'bloque', 'bloques', 'el', 'la', 'los', 'las', 'de', 'del']);
function nombreBase(s) {
    const t = norm(s).split(' ').filter(w => w && !STOP.has(w)).join(' ');
    return t || norm(s); // si todo era genérico, usar el nombre completo
}

// ---------------------------------------------------------------------------
// 1) Geocodificación con Nominatim (OpenStreetMap)
// ---------------------------------------------------------------------------
const PLUS_RE = /^[A-Z0-9]{4}\+[A-Z0-9]{2,}/i; // plus codes tipo "J56H+54G"

function candidatosConsulta(b) {
    const addr = b.address || '';
    const limpia = addr.split(',').map(s => s.trim()).filter(s => s && !PLUS_RE.test(s)).join(', ');
    const c = [];
    if (b.name) c.push(`${b.name}, ${addr}`);
    if (b.name && limpia && limpia !== addr) c.push(`${b.name}, ${limpia}`);
    if (limpia) c.push(limpia);
    return [...new Set(c)];
}

async function nominatim(query) {
    const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1' +
        '&countrycodes=ve&accept-language=es&q=' + encodeURIComponent(query);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
        const res = await fetch(url, {
            signal: ctrl.signal,
            headers: { 'User-Agent': 'vzla-sismo-verificador-edificios/1.0 (+https://metantonio.github.io/venezuela-sismo)' }
        });
        if (res.status === 429 || res.status === 503) {
            await sleep(4000); // una reintentona con espera extra
            return nominatim(query);
        }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (!data.length) return null;
        return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), display: data[0].display_name };
    } finally {
        clearTimeout(timer);
    }
}

async function verificarCoordenadas(buildings) {
    let cache = {};
    try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch (e) { /* sin caché aún */ }

    const lista = buildings.map((b, i) => ({ b, i }))
        .filter(x => x.b.lat != null && x.b.lng != null && (x.b.address || x.b.name))
        .slice(0, OPT.limit === Infinity ? undefined : OPT.limit);

    console.log(`\n=== Verificación de coordenadas (Nominatim/OSM, umbral ${OPT.umbral} m) ===`);
    console.log(`Edificios a contrastar: ${lista.length} (caché: ${Object.keys(cache).length} consultas guardadas)`);

    const resultados = [];
    let llamadas = 0;
    for (let k = 0; k < lista.length; k++) {
        const { b, i } = lista[k];
        let hit = null, usada = null;
        for (const q of candidatosConsulta(b)) {
            if (!(q in cache)) {
                try { cache[q] = await nominatim(q); }
                catch (e) { cache[q] = { error: e.message }; }
                llamadas++;
                await sleep(1100); // política Nominatim: máx. 1 req/s
            }
            const r = cache[q];
            if (r && !r.error) { hit = r; usada = q; break; }
        }
        const ref = { lat: b.lat, lng: b.lng };
        let estado, dist = null;
        if (!hit) estado = 'no_encontrado';
        else {
            dist = Math.round(distM(ref, hit));
            estado = dist <= OPT.umbral ? 'ok' : (dist <= OPT.umbral * 2.5 ? 'sospechoso' : 'discrepante');
        }
        resultados.push({ indice: i, nombre: b.name, direccion: b.address, lat: b.lat, lng: b.lng, estado, distancia_m: dist, osm: hit ? hit.display : null, consulta: usada });
        if ((k + 1) % 25 === 0 || k === lista.length - 1) {
            process.stdout.write(`  progreso: ${k + 1}/${lista.length} (llamadas API: ${llamadas})\r`);
        }
    }
    console.log('');

    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
    fs.writeFileSync(REPORT_FILE, JSON.stringify({
        generado: new Date().toISOString(), umbral_m: OPT.umbral,
        resumen: {
            total: resultados.length,
            ok: resultados.filter(r => r.estado === 'ok').length,
            sospechoso: resultados.filter(r => r.estado === 'sospechoso').length,
            discrepante: resultados.filter(r => r.estado === 'discrepante').length,
            no_encontrado: resultados.filter(r => r.estado === 'no_encontrado').length
        },
        resultados
    }, null, 2));

    const r = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8')).resumen;
    console.log(`Resultado: ${r.ok} ok · ${r.sospechoso} sospechosos · ${r.discrepante} discrepantes · ${r.no_encontrado} no encontrados`);
    const peores = resultados.filter(x => x.distancia_m != null).sort((a, b) => b.distancia_m - a.distancia_m).slice(0, 10);
    if (peores.length) {
        console.log('Mayores distancias OSM vs buildings.json:');
        peores.forEach(x => console.log(`  ${String(x.distancia_m).padStart(6)} m  [${x.indice}] ${x.nombre}`));
    }
    console.log(`Reporte completo: ${path.relative(ROOT, REPORT_FILE)}`);
    return resultados;
}

// ---------------------------------------------------------------------------
// 2) Detección de duplicados (union-find)
// ---------------------------------------------------------------------------
function encontrarDuplicados(buildings) {
    const n = buildings.length;
    const parent = Array.from({ length: n }, (_, i) => i);
    const find = (x) => parent[x] === x ? x : (parent[x] = find(parent[x]));
    const union = (a, b) => { parent[find(a)] = find(b); };

    const nb = buildings.map(b => nombreBase(b.name));
    const na = buildings.map(b => norm(b.address));
    const nn = buildings.map(b => norm(b.name));

    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            const d = distM(buildings[i], buildings[j]);
            if (d < 10) { union(i, j); continue; } // mismas coordenadas
            const sNom = Math.max(levSim(nn[i], nn[j]), levSim(nb[i], nb[j]));
            if (sNom < 0.85) continue;
            if (d < 80) { union(i, j); continue; } // nombre casi igual y muy cerca
            const sDir = Math.max(levSim(na[i], na[j]), jaccard(na[i], na[j]));
            if (sNom >= 0.9 && sDir >= 0.7) union(i, j); // mismo nombre y misma dirección
        }
    }

    const grupos = new Map();
    for (let i = 0; i < n; i++) {
        const r = find(i);
        if (!grupos.has(r)) grupos.set(r, []);
        grupos.get(r).push(i);
    }
    return [...grupos.values()].filter(g => g.length > 1);
}

function describir(b, i) {
    const foto = b.photo ? (Array.isArray(b.photo) ? b.photo.length + ' fotos' : '1 foto') : 'sin foto';
    return `    [${i}] "${b.name}" — zona: ${b.zone || '?'} · ${b.floors || '?'} pisos · ` +
        `${b.status || '?'} · (${b.lat.toFixed(5)}, ${b.lng.toFixed(5)}) · ${foto}` +
        `${b.boletin ? ' · boletín ' + b.boletin : ''}\n      dir: ${b.address || '(sin dirección)'}`;
}

async function revisarDuplicados(buildings) {
    console.log('\n=== Detección de duplicados ===');
    const grupos = encontrarDuplicados(buildings);
    if (!grupos.length) { console.log('No se encontraron duplicados. ✔'); return; }
    console.log(`Grupos de posibles duplicados: ${grupos.length} (edificios implicados: ${grupos.reduce((a, g) => a + g.length, 0)})`);

    if (OPT.soloReporte) {
        grupos.forEach((g, k) => {
            console.log(`\n  Grupo ${k + 1}:`);
            g.forEach(i => console.log(describir(buildings[i], i)));
        });
        console.log('\n(modo --solo-reporte: no se hicieron cambios)');
        return;
    }

    let eliminar = new Set();
    if (OPT.autoKeepFirst) {
        grupos.forEach(g => g.slice(1).forEach(i => eliminar.add(i)));
        console.log(`--auto-keep-first: se conservará el primero de cada grupo (${eliminar.size} a eliminar).`);
    } else {
        // Iterador asíncrono: las líneas se encolan aunque lleguen de golpe
        // (funciona igual con entrada interactiva y con tuberías).
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const it = rl[Symbol.asyncIterator]();
        const preguntar = async (q) => {
            process.stdout.write(q);
            const { value } = await it.next();
            return value == null ? '' : value;
        };
        for (let k = 0; k < grupos.length; k++) {
            const g = grupos[k];
            console.log(`\n  Grupo ${k + 1}/${grupos.length}:`);
            g.forEach((i, pos) => console.log(describir(buildings[i], i).replace(`[${i}]`, `(${pos + 1}) índice ${i}`)));
            for (;;) {
                const ans = (await preguntar(
                    '  ¿Cuáles conservar? Números separados por coma (ej: 1,3) · t = todos · Enter = todos: '
                )).trim().toLowerCase();
                if (ans === '' || ans === 't') break;
                const picks = ans.split(',').map(s => parseInt(s.trim(), 10));
                if (picks.length && picks.every(p => p >= 1 && p <= g.length)) {
                    g.forEach((idx, pos) => { if (!picks.includes(pos + 1)) eliminar.add(idx); });
                    break;
                }
                console.log('  Entrada no válida, intenta de nuevo.');
            }
        }
        rl.close();
    }

    if (!eliminar.size) { console.log('\nNo se eliminó nada. ✔'); return; }
    console.log(`\nSe eliminarán ${eliminar.size} edificio(s):`);
    [...eliminar].sort((a, b) => a - b).forEach(i => console.log(`  - [${i}] ${buildings[i].name}`));

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backup = path.join(ROOT, `buildings.backup-${stamp}.json`);
    fs.copyFileSync(FILE, backup);
    const limpio = buildings.filter((_, i) => !eliminar.has(i));
    fs.writeFileSync(FILE, JSON.stringify(limpio, null, 4) + '\n');
    console.log(`\nRespaldo creado: ${path.basename(backup)}`);
    console.log(`buildings.json actualizado: ${buildings.length} → ${limpio.length} edificios. ✔`);
}

// ---------------------------------------------------------------------------
(async () => {
    const buildings = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    console.log(`buildings.json: ${buildings.length} edificios cargados.`);
    if (OPT.geocode) await verificarCoordenadas(buildings);
    await revisarDuplicados(buildings);
})().catch(e => { console.error('\nERROR:', e.message); process.exit(1); });
