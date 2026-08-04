/**
 * build_urban_map.js — Mapeo de edificaciones reales de La Guaira (buildings.json) 
 * con las mallas 3D de scene.glb
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BUILDINGS_FILE = path.join(ROOT, 'buildings.json');
const GLB_FILE = path.join(ROOT, 'scene.glb');
const OUTPUT_FILE = path.join(ROOT, 'urban_buildings_map.json');

console.log('=== Generador de Mapeo Urbano 3D (buildings.json <-> scene.glb) ===');

if (!fs.existsSync(BUILDINGS_FILE) || !fs.existsSync(GLB_FILE)) {
    console.error('ERROR: No se encontró buildings.json o scene.glb en la raíz del proyecto.');
    process.exit(1);
}

// 1. Cargamos edificaciones de buildings.json
const buildings = JSON.parse(fs.readFileSync(BUILDINGS_FILE, 'utf8'));
const validGuaira = buildings.filter(b => 
    typeof b.lat === 'number' && typeof b.lng === 'number' &&
    b.lat >= 10.40 && b.lat <= 10.70 &&
    b.lng >= -67.20 && b.lng <= -66.50
);

console.log(`Cargadas ${buildings.length} edificaciones. ${validGuaira.length} se encuentran en el estado La Guaira.`);

// 2. Extraemos centros y bounding boxes de scene.glb
console.log('Leyendo jerarquía y mallas de scene.glb...');
const fd = fs.openSync(GLB_FILE, 'r');
const chunkHeaderBuf = Buffer.alloc(8);
fs.readSync(fd, chunkHeaderBuf, 0, 8, 12);
const chunkLen = chunkHeaderBuf.readUInt32LE(0);

const jsonBuf = Buffer.alloc(chunkLen);
fs.readSync(fd, jsonBuf, 0, chunkLen, 20);
const gltf = JSON.parse(jsonBuf.toString('utf8'));
fs.closeSync(fd);

let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
const meshList = [];

for (let i = 0; i < gltf.meshes.length; i++) {
    const mesh = gltf.meshes[i];
    for (const primitive of mesh.primitives) {
        if (primitive.attributes && primitive.attributes.POSITION !== undefined) {
            const posAcc = gltf.accessors[primitive.attributes.POSITION];
            if (posAcc && posAcc.min && posAcc.max) {
                const cx = (posAcc.min[0] + posAcc.max[0]) / 2;
                const cy = (posAcc.min[1] + posAcc.max[1]) / 2;
                const cz = (posAcc.min[2] + posAcc.max[2]) / 2;
                const height = posAcc.max[2] - posAcc.min[2];
                const widthX = posAcc.max[0] - posAcc.min[0];
                const widthY = posAcc.max[1] - posAcc.min[1];
                
                if (cx < minX) minX = cx;
                if (cx > maxX) maxX = cx;
                if (cy < minY) minY = cy;
                if (cy > maxY) maxY = cy;

                meshList.push({
                    meshIndex: i,
                    x: cx,
                    y: cy,
                    z: cz,
                    height,
                    widthX,
                    widthY
                });
            }
        }
    }
}

console.log(`Procesadas ${meshList.length} mallas. Rango GLB X: [${minX.toFixed(1)}, ${maxX.toFixed(1)}], Y: [${minY.toFixed(1)}, ${maxY.toFixed(1)}]`);

// 3. Proyección Geográfica Lat/Lng -> GLB (X, Y)
// Centro empírico exacto del catálogo de La Guaira (coincide 100% con app.js)
const centerLat = 10.610409;
const centerLng = -66.851920;
const centerX = (minX + maxX) / 2;
const centerY = (minY + maxY) / 2;

const DEG_TO_M_LAT = 110574;
const DEG_TO_M_LNG = 111320 * Math.cos(centerLat * Math.PI / 180);

function projectLatLngToGLB(lat, lng) {
    const x = (lng - centerLng) * DEG_TO_M_LNG + centerX;
    const y = (lat - centerLat) * DEG_TO_M_LAT + centerY;
    return { x, y };
}

// 4. Mapeo de cada edificio con las mallas más cercanas dentro del modelo 3D
const mappedBuildings = [];
let matchedCount = 0;
let collapsedMatchedCount = 0;

validGuaira.forEach(b => {
    const projected = projectLatLngToGLB(b.lat, b.lng);
    
    // Solo procesamos edificaciones que caen dentro o cerca del área 3D de scene.glb
    if (projected.x < minX - 300 || projected.x > maxX + 300 || projected.y < minY - 300 || projected.y > maxY + 300) {
        return;
    }

    // Buscamos la malla más cercana
    let closestMesh = null;
    let minDist = Infinity;

    for (const m of meshList) {
        const d = Math.hypot(m.x - projected.x, m.y - projected.y);
        if (d < minDist) {
            minDist = d;
            closestMesh = m;
        }
    }

    const isMatch = minDist <= 250;
    if (isMatch) matchedCount++;
    if (isMatch && (b.status === 'collapsed' || b.damage_level === 'total' || b.boletin === 'rojo')) collapsedMatchedCount++;

    mappedBuildings.push({
        id: b.id,
        name: b.name || 'Edificación Sin Nombre',
        zone: b.zone || 'La Guaira',
        address: b.address || '',
        lat: b.lat,
        lng: b.lng,
        floors: b.floors || 5,
        status: b.status || 'unknown',
        damage_level: b.damage_level || 'desconocido',
        photo: b.photo || null,
        boletin: b.boletin || 'verde',
        projectedGLB: projected,
        meshIndex: closestMesh ? closestMesh.meshIndex : null,
        meshPosition: closestMesh ? { x: closestMesh.x, y: closestMesh.y, z: closestMesh.z } : null,
        meshHeight: closestMesh ? closestMesh.height : 10,
        distToMeshMeters: Number(minDist.toFixed(1))
    });
});

console.log(`Mapeo completado: ${matchedCount} / ${mappedBuildings.length} edificios en el área 3D asociados a mallas.`);
console.log(`Edificios colapsados emparejados en 3D: ${collapsedMatchedCount}.`);

const outputData = {
    metadata: {
        generatedAt: new Date().toISOString(),
        totalBuildingsIn3D: mappedBuildings.length,
        matchedCount,
        collapsedMatchedCount,
        centerLat,
        centerLng,
        centerX,
        centerY,
        degToMetersLat: DEG_TO_M_LAT,
        degToMetersLng: DEG_TO_M_LNG,
        glbBounds: { minX, maxX, minY, maxY }
    },
    buildings: mappedBuildings
};

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(outputData, null, 2), 'utf8');
console.log(`Fichero ${OUTPUT_FILE} generado exitosamente con ${mappedBuildings.length} edificios mapeados! ✔`);
