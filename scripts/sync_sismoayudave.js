const fs = require('fs');
const path = require('path');
const https = require('https');

const BUILDINGS_PATH = path.join(__dirname, '..', 'buildings.json');

const ENDPOINTS = {
    civInspecciones: 'https://services8.arcgis.com/F4wmVgGRtJMzSu8M/arcgis/rest/services/CIV_Inspección/FeatureServer/2',
    solicitudes: 'https://services8.arcgis.com/F4wmVgGRtJMzSu8M/arcgis/rest/services/solicitudes_inspeccion/FeatureServer/0',
    zonasAtr: 'https://services8.arcgis.com/F4wmVgGRtJMzSu8M/arcgis/rest/services/ZONAS_ATR_Edf/FeatureServer/0'
};

function httpGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error(`Failed to parse JSON response: ${e.message}`));
                }
            });
        }).on('error', reject);
    });
}

async function fetchAllArcGISFeatures(serviceUrl, outSR = '4326') {
    const features = [];
    const pageSize = 1000;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
        const queryUrl = `${serviceUrl}/query?where=1%3D1&outFields=*&outSR=${outSR}&resultOffset=${offset}&resultRecordCount=${pageSize}&f=json`;
        const res = await httpGet(queryUrl);

        if (!res.features || res.features.length === 0) {
            hasMore = false;
        } else {
            features.push(...res.features);
            if (res.features.length < pageSize) {
                hasMore = false;
            } else {
                offset += pageSize;
            }
        }
    }
    return features;
}

function calculateDistanceMeters(lat1, lng1, lat2, lng2) {
    const latMid = (lat1 + lat2) / 2.0;
    const mPerDegLat = 110540.0;
    const mPerDegLng = 111320.0 * Math.cos(latMid * Math.PI / 180.0);
    const dy = (lat1 - lat2) * mPerDegLat;
    const dx = (lng1 - lng2) * mPerDegLng;
    return Math.sqrt(dx * dx + dy * dy);
}

function pointInPolygonRings(lng, lat, rings) {
    let inside = false;
    for (let r = 0; r < rings.length; r++) {
        const ring = rings[r];
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const xi = ring[i][0], yi = ring[i][1];
            const xj = ring[j][0], yj = ring[j][1];
            const intersect = ((yi > lat) !== (yj > lat)) &&
                (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
    }
    return inside;
}

function normalizeName(name) {
    if (!name) return '';
    return name.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function isDuplicate(b1, b2) {
    if (b1.id && b2.id && b1.id === b2.id) return true;
    if (b1.code_civ && b2.code_civ && b1.code_civ === b2.code_civ) return true;

    const dist = calculateDistanceMeters(b1.lat, b1.lng, b2.lat, b2.lng);
    if (dist < 15) return true; // Very close proximity (15m)

    const n1 = normalizeName(b1.name);
    const n2 = normalizeName(b2.name);
    if (dist < 50 && n1.length > 3 && n2.length > 3 && (n1 === n2 || n1.includes(n2) || n2.includes(n1))) {
        return true;
    }

    return false;
}

async function runSync() {
    console.log('=== SINCRONIZACIÓN DE DATOS DESDE SISMOAYUDAVE.COM ===');

    // 1. Cargar edificios locales
    let localBuildings = [];
    if (fs.existsSync(BUILDINGS_PATH)) {
        localBuildings = JSON.parse(fs.readFileSync(BUILDINGS_PATH, 'utf8'));
        console.log(`Cargadas ${localBuildings.length} edificaciones locales existentes.`);
    } else {
        console.log('No se encontró buildings.json previo. Se creará uno nuevo.');
    }

    // 2. Fetch Zonas ATR
    console.log('\nObteniendo Zonas ATR...');
    const atrFeatures = await fetchAllArcGISFeatures(ENDPOINTS.zonasAtr, '4326');
    console.log(`Zonas ATR obtenidas: ${atrFeatures.length}`);

    // 3. Fetch Inspecciones CIV
    console.log('\nObteniendo Inspecciones Presenciales CIV...');
    const civFeatures = await fetchAllArcGISFeatures(ENDPOINTS.civInspecciones, '4326');
    console.log(`Inspecciones CIV obtenidas: ${civFeatures.length}`);

    // 4. Fetch Solicitudes de Inspección
    console.log('\nObteniendo Solicitudes de Inspección...');
    const solFeatures = await fetchAllArcGISFeatures(ENDPOINTS.solicitudes, '4326');
    console.log(`Solicitudes obtenidas: ${solFeatures.length}`);

    // Mapa de solicitudes para indexado rápido por código o proximidad
    const solicitudesMap = new Map();
    solFeatures.forEach(f => {
        const attr = f.attributes;
        if (attr.codigo) solicitudesMap.set(attr.codigo, attr);
    });

    let updatedCount = 0;
    let addedCount = 0;

    // Process CIV Inspections
    console.log('\nProcesando e integrando inspecciones CIV...');
    for (const f of civFeatures) {
        const attr = f.attributes;
        const lat = parseFloat(attr.lat);
        const lng = parseFloat(attr.lng);

        if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) continue;

        // Determine boletin color
        let boletin = null;
        if (attr.etiqueta) {
            const et = attr.etiqueta.trim().toLowerCase();
            if (et.includes('verde')) boletin = 'verde';
            else if (et.includes('amarillo')) boletin = 'amarillo';
            else if (et.includes('rojo')) boletin = 'rojo';
        }

        if (!boletin && attr.decision_final) {
            const dec = attr.decision_final.toUpperCase();
            if (dec === 'A') boletin = 'verde';
            else if (dec === 'B') boletin = 'amarillo';
            else if (dec === 'C') boletin = 'rojo';
        }

        let status = 'damaged';
        let damageLevel = 'parcial';
        if (boletin === 'rojo') {
            status = 'collapsed';
            damageLevel = 'total';
        } else if (boletin === 'amarillo') {
            status = 'damaged';
            damageLevel = 'severo';
        } else if (boletin === 'verde') {
            status = 'damaged';
            damageLevel = 'leve';
        }

        const civBuilding = {
            id: attr.codigo || `CIV-${attr.OBJECTID}`,
            code_civ: attr.codigo || null,
            name: attr.nombre_edificacion || 'Edificación sin nombre',
            zone: attr.municipio || attr.estado_geo || 'Vargas',
            address: attr.direccion || '',
            lat: lat,
            lng: lng,
            floors: 5,
            status: status,
            damage_level: damageLevel,
            photo: '',
            real: true,
            boletin: boletin,
            requested: false
        };

        // Match existing local building
        const existingIdx = localBuildings.findIndex(b => isDuplicate(b, civBuilding));
        if (existingIdx !== -1) {
            const existing = localBuildings[existingIdx];
            if (boletin) existing.boletin = boletin;
            if (attr.codigo) existing.code_civ = attr.codigo;
            if (existing.status !== 'collapsed' && civBuilding.status === 'collapsed') {
                existing.status = 'collapsed';
                existing.damage_level = 'total';
            }
            updatedCount++;
        } else {
            localBuildings.push(civBuilding);
            addedCount++;
        }
    }

    // Process Solicitudes de Inspección
    console.log('Procesando e integrando solicitudes de inspección...');
    let addedSolicitudes = 0;
    for (const f of solFeatures) {
        const attr = f.attributes;
        const lat = parseFloat(attr.lat);
        const lng = parseFloat(attr.lng);

        if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) continue;

        let numPisos = 5;
        if (attr.num_pisos) {
            const p = parseInt(attr.num_pisos, 10);
            if (!isNaN(p) && p > 0 && p < 50) numPisos = p;
        }

        const solBuilding = {
            id: attr.codigo || `SOL-${attr.OBJECTID}`,
            name: attr.nombre_edificacion || 'Solicitud de evaluación',
            zone: attr.municipio || attr.estado || 'Vargas',
            address: attr.direccion || attr.referencia || '',
            lat: lat,
            lng: lng,
            floors: numPisos,
            status: 'damaged',
            damage_level: 'parcial',
            photo: '',
            real: true,
            requested: true
        };

        const existingIdx = localBuildings.findIndex(b => isDuplicate(b, solBuilding));
        if (existingIdx !== -1) {
            localBuildings[existingIdx].requested = true;
        } else {
            localBuildings.push(solBuilding);
            addedSolicitudes++;
        }
    }

    // Tag Zonas ATR (Point-in-Polygon)
    console.log('\nEvaluando pertenencia a Zonas ATR...');
    let atrCount = 0;
    for (const b of localBuildings) {
        let insideAtr = false;
        let atrZoneId = null;

        for (const atr of atrFeatures) {
            if (atr.geometry && atr.geometry.rings) {
                if (pointInPolygonRings(b.lng, b.lat, atr.geometry.rings)) {
                    insideAtr = true;
                    atrZoneId = atr.attributes.ZoneID || atr.attributes.MUNICIPIO || 'ATR';
                    break;
                }
            }
        }

        b.atr = insideAtr;
        if (insideAtr && atrZoneId) {
            b.atr_zone = atrZoneId;
            atrCount++;
        }
    }

    console.log(`\n=== RESUMEN DE SINCRONIZACIÓN ===`);
    console.log(`Edificaciones actualizadas: ${updatedCount}`);
    console.log(`Nuevas edificaciones CIV agregadas: ${addedCount}`);
    console.log(`Nuevas solicitudes agregadas: ${addedSolicitudes}`);
    console.log(`Edificaciones en Zonas ATR: ${atrCount}`);
    console.log(`Total final de edificaciones en catalog: ${localBuildings.length}`);

    // Generar respaldo
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(__dirname, '..', `buildings.backup-${timestamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(localBuildings, null, 4), 'utf8');
    console.log(`\nRespaldo creado en: ${path.basename(backupPath)}`);

    // Escribir archivo final buildings.json
    fs.writeFileSync(BUILDINGS_PATH, JSON.stringify(localBuildings, null, 4) + '\n', 'utf8');
    console.log(`buildings.json actualizado exitosamente. ✔`);
}

runSync().catch(err => {
    console.error('Error durante la sincronización:', err);
    process.exit(1);
});
