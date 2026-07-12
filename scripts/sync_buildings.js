const fs = require('fs');
const path = require('path');
const https = require('https');

const buildingsJsonPath = path.join(__dirname, '..', 'buildings.json');
const supabaseUrl = 'https://jckifxsdlnsvbztxydes.supabase.co/rest/v1/buildings';
const anonKey = 'sb_publishable_i7iEDrCVZcSt0k3RGFrY4g_WrtZBB4w';

function get(url) {
    return new Promise((resolve, reject) => {
        https.get(url, {
            headers: {
                'apikey': anonKey,
                'Authorization': `Bearer ${anonKey}`,
                'User-Agent': 'Mozilla/5.0'
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

function isDuplicate(b1, b2) {
    if (b1.id === b2.id) return true;
    
    // Proximity check (approx 10 meters)
    const latDiff = Math.abs(b1.lat - b2.lat);
    const lngDiff = Math.abs(b1.lng - b2.lng);
    if (latDiff < 0.0001 && lngDiff < 0.0001) return true;
    
    // Name and zone/city matching
    if (b1.name.trim().toLowerCase() === b2.name.trim().toLowerCase() && 
        (b1.zone || '').trim().toLowerCase() === (b2.zone || '').trim().toLowerCase()) {
        return true;
    }
    
    return false;
}

async function run() {
    console.log('Cargando edificaciones locales de buildings.json...');
    let localBuildings = [];
    if (fs.existsSync(buildingsJsonPath)) {
        try {
            localBuildings = JSON.parse(fs.readFileSync(buildingsJsonPath, 'utf8'));
        } catch (e) {
            console.error('Error al leer buildings.json:', e.message);
            process.exit(1);
        }
    } else {
        console.error('No se encontró el archivo buildings.json en:', buildingsJsonPath);
        process.exit(1);
    }
    console.log(`Edificaciones locales iniciales: ${localBuildings.length}`);

    console.log('Obteniendo edificaciones de terremotovenezuela.com (Supabase)...');
    let fetchedData;
    try {
        const raw = await get(supabaseUrl);
        fetchedData = JSON.parse(raw);
    } catch (e) {
        console.error('Error al realizar la petición a Supabase:', e.message);
        process.exit(1);
    }
    console.log(`Edificaciones obtenidas del servidor: ${fetchedData.length}`);

    let addedCount = 0;
    let duplicateCount = 0;

    for (const remote of fetchedData) {
        const lat = parseFloat(remote.lat);
        const lng = parseFloat(remote.lng);
        
        if (isNaN(lat) || isNaN(lng)) {
            continue;
        }

        // Try to parse floor count from notes or name
        let floors = 5; // default
        const notes = remote.notes || '';
        const name = remote.name || '';
        const floorMatch = (name + ' ' + notes).match(/(?:(\d+)\s*(?:pisos|plantas|niveles|piso|nivel))/i);
        if (floorMatch) {
            const val = parseInt(floorMatch[1], 10);
            if (val >= 1 && val <= 30) {
                floors = val;
            }
        }

        // Map damage level to local status
        let status = 'damaged';
        let damageLevel = 'severo';
        if (remote.damage_level === 'total') {
            status = 'collapsed';
            damageLevel = 'total';
        } else if (remote.damage_level === 'severo') {
            status = 'damaged';
            damageLevel = 'severo';
        } else if (remote.damage_level === 'parcial') {
            status = 'damaged';
            damageLevel = 'parcial';
        }

        const mapped = {
            id: remote.id,
            name: remote.name || 'Sin Nombre',
            zone: remote.zone || remote.city || 'Vargas',
            address: remote.address || '',
            lat: lat,
            lng: lng,
            floors: floors,
            status: status,
            damage_level: damageLevel,
            photo: remote.main_photo_url || '',
            real: true
        };

        const dup = localBuildings.some(local => isDuplicate(local, mapped));
        if (dup) {
            duplicateCount++;
        } else {
            localBuildings.push(mapped);
            addedCount++;
        }
    }

    console.log(`Registros duplicados omitidos: ${duplicateCount}`);
    console.log(`Nuevas edificaciones agregadas: ${addedCount}`);
    console.log(`Total de edificaciones final en buildings.json: ${localBuildings.length}`);

    if (addedCount > 0) {
        try {
            fs.writeFileSync(buildingsJsonPath, JSON.stringify(localBuildings, null, 4), 'utf8');
            console.log('Archivo buildings.json actualizado correctamente.');
        } catch (e) {
            console.error('Error al guardar el archivo buildings.json:', e.message);
            process.exit(1);
        }
    } else {
        console.log('No se agregaron nuevas edificaciones. No fue necesario modificar buildings.json.');
    }
}

run().catch(console.error);
