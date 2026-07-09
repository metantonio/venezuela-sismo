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

// Format new building JSON object matching app.js style
const newBuildingFormatted = `        {
                "id": "${newBuilding.id}",
                "name": "${newBuilding.name.replace(/"/g, '\\"')}",
                "zone": "${(newBuilding.zone || '').replace(/"/g, '\\"')}",
                "address": "${(newBuilding.address || '').replace(/"/g, '\\"')}",
                "lat": ${newBuilding.lat},
                "lng": ${newBuilding.lng},
                "floors": ${newBuilding.floors},
                "status": "${newBuilding.status}",
                "damage_level": "${newBuilding.damage_level}",
                "photo": "${(newBuilding.photo || '').replace(/"/g, '\\"')}",
                "real": ${newBuilding.real}
        },`;

// Read app.js
const appJsPath = path.join(__dirname, '..', 'app.js');
let appJsContent = fs.readFileSync(appJsPath, 'utf8');

// Find insertion point right after 'const buildings = ['
const buildingsStartToken = 'const buildings = [';
const index = appJsContent.indexOf(buildingsStartToken);

if (index === -1) {
    console.error('Error: No se encontró la declaración "const buildings = [" en app.js.');
    process.exit(1);
}

const insertionPoint = index + buildingsStartToken.length;

// Insert new building at the beginning of the array
appJsContent = 
    appJsContent.slice(0, insertionPoint) + 
    '\n' + 
    newBuildingFormatted + 
    appJsContent.slice(insertionPoint);

// Save updated app.js
fs.writeFileSync(appJsPath, appJsContent, 'utf8');
console.log(`Éxito: Edificación "${newBuilding.name}" agregada correctamente a app.js con ID: ${newBuilding.id}`);
