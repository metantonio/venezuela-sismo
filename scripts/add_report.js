const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Get issue body from GitHub Actions environment
const issueBody = process.env.ISSUE_BODY || '';
if (!issueBody) {
    console.error('Error: No se recibió el cuerpo del issue (ISSUE_BODY).');
    process.exit(1);
}

// Find JSON block in the issue body
let jsonText = '';
const codeBlockRegex = /```json\s*([\s\S]*?)```/;
const match = issueBody.match(codeBlockRegex);

if (match) {
    jsonText = match[1].trim();
} else {
    // Fallback: try to extract anything between the first '{' and the last '}'
    const braceRegex = /(\{[\s\S]*\})/;
    const braceMatch = issueBody.match(braceRegex);
    if (braceMatch) {
        jsonText = braceMatch[1].trim();
    }
}

if (!jsonText) {
    console.error('Error: No se encontró ningún bloque JSON válido en el reporte.');
    process.exit(1);
}

let newBuilding;
try {
    newBuilding = JSON.parse(jsonText);
} catch (e) {
    console.error('Error al parsear el JSON:', e.message);
    process.exit(1);
}

// Validate required fields
const required = ['name', 'lat', 'lng', 'floors', 'status', 'damage_level'];
for (const field of required) {
    if (newBuilding[field] === undefined) {
        console.error(`Error: El campo obligatorio "${field}" está ausente en el reporte.`);
        process.exit(1);
    }
}

// Normalize fields
newBuilding.id = newBuilding.id || crypto.randomUUID();
newBuilding.real = newBuilding.real !== undefined ? newBuilding.real : true;
newBuilding.lat = parseFloat(newBuilding.lat);
newBuilding.lng = parseFloat(newBuilding.lng);
newBuilding.floors = parseInt(newBuilding.floors, 10);

// Read buildings.json
const buildingsJsonPath = path.join(__dirname, '..', 'buildings.json');
let buildings = [];

if (fs.existsSync(buildingsJsonPath)) {
    try {
        buildings = JSON.parse(fs.readFileSync(buildingsJsonPath, 'utf8'));
    } catch (e) {
        console.error('Error al parsear buildings.json:', e.message);
        process.exit(1);
    }
} else {
    console.error('Error: No se encontró el archivo buildings.json.');
    process.exit(1);
}

// Insert new building at the beginning of the array
buildings.unshift(newBuilding);

// Save updated buildings.json
fs.writeFileSync(buildingsJsonPath, JSON.stringify(buildings, null, 4), 'utf8');
console.log(`Éxito: Edificación "${newBuilding.name}" agregada correctamente a buildings.json con ID: ${newBuilding.id}`);
