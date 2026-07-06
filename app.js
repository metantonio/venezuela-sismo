// app.js - Simulación Sísmica COVENIN 1756

// --- PARÁMETROS GLOBALES Y CONFIGURACIÓN ---
const G = 9.81; // g (m/s^2)
let simInterval = null;
let isPlaying = false;
let isPaused = false;
let currentTime = 0; // tiempo actual en segundos
let simStepIndex = 0; // índice en la serie de tiempo

// Datos de la simulación
let dt = 0.01; // paso de tiempo del solver (s)
let totalDuration = 80; // duración total (s)
let timeSeries = []; // array de tiempos
let groundAccel = []; // array de aceleración del terreno (g)

// Estructuras de los edificios
let eq2001 = null;
let eq2019 = null;

// Instancias de Gráficos (Chart.js)
let spectraChartInstance = null;
let accelChartInstance = null;
let dispChartInstance = null;
let hyst2001ChartInstance = null;
let hyst2019ChartInstance = null;
let vargasChartInstance = null;
let damageMapInstance = null; // Leaflet map for damage visualization

// Escena de Three.js
let scene, camera, renderer, controls;
let buildings3D = {
    b2001: { group: null, floors: [], columns: [] },
    b2019: { group: null, floors: [], columns: [] }
};
let groundPlane;
let gridHelper;
let particleSystem = null;
let particlesCount = 200;
let particlesData = [];

// Estados de Evacuación
let evacuation2001 = { meshes: [], currentFloor: 0, startTime: null, escaped: false, trapped: false };
let evacuation2019 = { meshes: [], currentFloor: 0, startTime: null, escaped: false, trapped: false };

// Indicadores de Fuerza Cortante Base (Corte Basal)
let arrow2001 = null;
let arrow2019 = null;

// Materiales de Rótulas Plásticas
const hingeYellowMat = new THREE.MeshStandardMaterial({
    color: 0xffca28,
    emissive: 0xffca28,
    emissiveIntensity: 0.6,
    roughness: 0.2
});
const hingeRedMat = new THREE.MeshStandardMaterial({
    color: 0xff1744,
    emissive: 0xff1744,
    emissiveIntensity: 0.7,
    roughness: 0.2
});

// Selección e iluminación de columnas 3D
let selectedColumn = null;
let selectionHighlightMesh = null;
let selectionHighlightOutline = null;
let initialReportHTML = "";

// Datos globales del diseño de vigas (para visualización 3D post-simulación)
let lastBeamDesignX = null;
let lastBeamDesignY = null;
let lastStructuralConfig = null; // { nBaysX, nBaysY, numColsX, numColsY, sX, sY, storyHeight }

// Estados interactivos para visualización 3D de vigas
let beamViewMode = 'xray'; // 'solid' o 'xray'
let hoverBeamX_t = null; // t de hover en viga X (null si no hay hover)
let hoverBeamY_t = null; // t de hover en viga Y (null si no hay hover)
let beamAnimTime = 0;    // tiempo de animación local para oscilación
let beamAnimActive = true; // animación activa por defecto
let beamRotX = { X: -0.15, Y: -0.15 }; // rotación en pitch para viga X e Y
let beamRotY = { X: 0.35, Y: 0.35 };   // rotación en yaw para viga X e Y
let beamPanX = { X: 0, Y: 0 };         // desplazamiento en X de la cámara (panning)
let beamPanY = { X: 0, Y: 0 };         // desplazamiento en Y de la cámara (panning)

// --- INICIALIZACIÓN ---
document.addEventListener("DOMContentLoaded", () => {
    try {
        initUI();
    } catch (e) {
        console.error('[initUI]', e);
    }
    try {
        initThreeJS();
    } catch (e) {
        console.error('[initThreeJS]', e);
        document.getElementById('canvas-3d-container').innerHTML = '<div style="color:red;padding:20px;font-size:12px;">[3D ERROR] ' + e.message + '</div>';
    }
    try {
        generateSpectraAndEarthquake();
    } catch (e) {
        console.error('[generateSpectraAndEarthquake]', e);
        // Show error somewhere visible
        const el = document.querySelector('.content-area') || document.body;
        const errDiv = document.createElement('div');
        errDiv.style = 'position:fixed;top:0;left:50%;transform:translateX(-50%);background:rgba(200,0,0,0.9);color:white;padding:8px 16px;z-index:9999;border-radius:0 0 6px 6px;font-size:12px;max-width:600px;word-break:break-all;';
        errDiv.textContent = '⚠ JS Error: ' + e.message + ' (line ' + (e.stack ? e.stack.split('\n')[1] : '?') + ')';
        document.body.appendChild(errDiv);
    }
    try {
        animate3D();
    } catch (e) {
        console.error('[animate3D]', e);
    }
    try {
        initVargasChart();
    } catch (e) {
        console.error('[initVargasChart]', e);
    }
});


// --- INTERFAZ DE USUARIO (EVENTOS Y TABS) ---
function initUI() {
    // Tab switching
    const tabBtns = document.querySelectorAll(".tab-btn");
    const tabContents = document.querySelectorAll(".tab-content, .control-panel");

    tabBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            tabBtns.forEach(b => b.classList.remove("active"));
            tabContents.forEach(c => c.classList.remove("active"));

            btn.classList.add("active");
            const tabId = btn.getAttribute("data-tab");
            document.getElementById(tabId).classList.add("active");

            // Forzar redibujado de charts en tabs ocultos
            if (tabId === "tab-spectra" && spectraChartInstance) {
                spectraChartInstance.resize();
            } else if (tabId === "tab-response") {
                if (accelChartInstance) accelChartInstance.resize();
                if (dispChartInstance) dispChartInstance.resize();
                if (hyst2001ChartInstance) hyst2001ChartInstance.resize();
                if (hyst2019ChartInstance) hyst2019ChartInstance.resize();
            } else if (tabId === "tab-sismos") {
                const container = document.getElementById("sismos-list-container");
                if (container && container.children.length === 0) {
                    fetchRecentEarthquakes();
                }
            } else if (tabId === "tab-vargas" && vargasChartInstance) {
                vargasChartInstance.resize();
            } else if (tabId === "tab-damage-map") {
                if (!damageMapInstance) {
                    setTimeout(() => { initDamageMap(); }, 100);
                } else {
                    damageMapInstance.invalidateSize();
                }
            }
        });
    });

    // Botón de refrescar sismos recientes
    const refreshSismosBtn = document.getElementById("btn-refresh-sismos");
    if (refreshSismosBtn) {
        refreshSismosBtn.addEventListener("click", () => {
            fetchRecentEarthquakes();
        });
    }

    // Inputs dinámicos (actualizar etiquetas de valores)
    const setupSlider = (id, suffix = "") => {
        const slider = document.getElementById(id);
        const valSpan = document.getElementById(`${id}-val`);
        if (slider && valSpan) {
            slider.addEventListener("input", () => {
                valSpan.textContent = slider.value + suffix;
                // Si la simulación está corriendo, reiniciarla o regenerar espectros
                if (!isPlaying) {
                    generateSpectraAndEarthquake();
                }
            });
        }
    };

    setupSlider("num-stories");
    setupSlider("num-cols-x");
    setupSlider("num-cols-y");
    setupSlider("col-dist-x", " m");
    setupSlider("col-dist-y", " m");
    setupSlider("story-height", " m");
    setupSlider("story-mass", " ton");

    // Amortiguamiento
    const dampSlider = document.getElementById("damping-ratio");
    const dampSpan = document.getElementById("damping-ratio-val");
    dampSlider.addEventListener("input", () => {
        dampSpan.textContent = Math.round(dampSlider.value * 100) + "%";
        if (!isPlaying) generateSpectraAndEarthquake();
    });

    // Excentricidad Torsional
    const eccSlider = document.getElementById("torsional-eccentricity");
    const eccSpan = document.getElementById("torsional-eccentricity-val");
    if (eccSlider && eccSpan) {
        eccSlider.addEventListener("input", () => {
            eccSpan.textContent = Math.round(eccSlider.value * 100) + "%";
            if (!isPlaying) generateSpectraAndEarthquake();
        });
    }

    const showCmCrCheck = document.getElementById("show-cm-cr");
    if (showCmCrCheck) {
        showCmCrCheck.addEventListener("change", () => {
            const visible = showCmCrCheck.checked;
            if (buildings3D.b2001.cmCrGroup) buildings3D.b2001.cmCrGroup.visible = visible;
            if (buildings3D.b2019.cmCrGroup) buildings3D.b2019.cmCrGroup.visible = visible;
        });
    }

    const showFlexureCheck = document.getElementById("show-flexure-deformation");
    if (showFlexureCheck) {
        showFlexureCheck.addEventListener("change", () => {
            rebuild3DStructures();
            resetSimulation();
        });
    }

    // 2019 Sliders
    setupSlider("covenin19-a0");
    setupSlider("covenin19-a1");

    // Sliders de Aceleración PGA Sismos
    setupSlider("sismo1-pga", "g");
    setupSlider("sismo2-pga", "g");

    // Sliders de Secciones Personalizadas
    setupSlider("col-width", " cm");
    setupSlider("col-depth", " cm");
    setupSlider("beam-width", " cm");
    setupSlider("beam-depth", " cm");
    // Resistencia de materiales (kgf/cm²)
    setupSlider("concrete-fc-col", " kgf/cm²");
    setupSlider("concrete-fc-beam", " kgf/cm²");
    setupSlider("steel-fy-col", " kgf/cm²");
    setupSlider("steel-fy-beam", " kgf/cm²");
    // Refuerzo de vigas (cm²)
    setupSlider("col-as", " cm²");
    setupSlider("beam-as", " cm²");
    setupSlider("beam-as-prime", " cm²");

    // Checkbox para habilitar secciones personalizadas
    const customSectionsCheck = document.getElementById("custom-sections-enable");
    const customSectionsControls = document.getElementById("custom-sections-controls");

    if (customSectionsCheck && customSectionsControls) {
        customSectionsCheck.addEventListener("change", () => {
            customSectionsControls.style.display = customSectionsCheck.checked ? "block" : "none";
            if (!isPlaying) generateSpectraAndEarthquake();
        });
        // Sincronizar estado inicial
        customSectionsControls.style.display = customSectionsCheck.checked ? "block" : "none";
    }

    // Checkbox para autocalcular masa sísmica
    const autoMassCheck = document.getElementById("auto-mass");
    const manualMassCont = document.getElementById("manual-mass-container");
    const autoMassCont = document.getElementById("auto-mass-controls");
    if (autoMassCheck && manualMassCont && autoMassCont) {
        autoMassCheck.addEventListener("change", () => {
            manualMassCont.style.display = autoMassCheck.checked ? "none" : "block";
            autoMassCont.style.display = autoMassCheck.checked ? "block" : "none";
            if (!isPlaying) generateSpectraAndEarthquake();
        });
        // Sincronizar estado inicial
        manualMassCont.style.display = autoMassCheck.checked ? "none" : "block";
        autoMassCont.style.display = autoMassCheck.checked ? "block" : "none";
    }

    // Sliders de masa y cargas sísmicas
    setupSlider("slab-thickness", " cm");
    setupSlider("extra-dead-load", " kgf/m²");

    // Selects
    const selects = [
        "covenin01-zone", "covenin01-soil", "covenin01-r", "covenin01-importance",
        "covenin19-soil-class", "covenin19-r", "covenin19-rho", "covenin19-fi",
        "analysis-mode", "degradation-severity", "double-earthquake",
        "sismo1-direction", "sismo2-direction", "building-use", "evacuation-mode"
    ];
    selects.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener("change", () => {
                if (!isPlaying) generateSpectraAndEarthquake();
            });
        }
    });

    // Botones
    document.getElementById("btn-run").addEventListener("click", toggleSimulation);
    document.getElementById("btn-pause").addEventListener("click", pauseSimulation);
    document.getElementById("btn-reset").addEventListener("click", resetSimulation);

    // Preset Vargas
    const btnPresetVargas = document.getElementById("btn-preset-vargas");
    if (btnPresetVargas) {
        btnPresetVargas.addEventListener("click", () => {
            // Si está corriendo la simulación, detenerla y forzar reinicio
            if (isPlaying) {
                toggleSimulation();
            }

            // Actualizar controles programáticamente
            const setSlider = (id, val, suffix = "") => {
                const slider = document.getElementById(id);
                const valSpan = document.getElementById(`${id}-val`);
                if (slider) {
                    slider.value = val;
                    if (valSpan) valSpan.textContent = val + suffix;
                }
            };

            const setSelect = (id, val) => {
                const select = document.getElementById(id);
                if (select) select.value = val;
            };

            const setCheck = (id, checked) => {
                const check = document.getElementById(id);
                if (check) check.checked = checked;
            };

            // Geometría y Carga
            setSlider("num-stories", 6);
            setSlider("num-cols-x", 5);
            setSlider("num-cols-y", 4);
            setSlider("col-dist-x", 4.0, " m");
            setSlider("col-dist-y", 4.0, " m");
            setSlider("story-height", 3.0, " m");
            setCheck("auto-mass", true);
            setSelect("building-use", "residential");
            setSlider("slab-thickness", 15, " cm");
            setSlider("extra-dead-load", 250, " kgf/m²");

            // Amortiguamiento
            setSlider("damping-ratio", 0.05);
            const dampValSpan = document.getElementById("damping-ratio-val");
            if (dampValSpan) dampValSpan.textContent = "5%";

            // Excentricidad
            setSlider("torsional-eccentricity", 0.05);
            const eccValSpan = document.getElementById("torsional-eccentricity-val");
            if (eccValSpan) eccValSpan.textContent = "5%";

            // Secciones Físicas (SCWB)
            setCheck("custom-sections-enable", true);
            const customSectionsControls = document.getElementById("custom-sections-controls");
            if (customSectionsControls) customSectionsControls.style.display = "block";

            setSlider("col-width", 45, " cm");
            setSlider("col-depth", 50, " cm");
            setSlider("beam-width", 30, " cm");
            setSlider("beam-depth", 45, " cm");

            setSlider("concrete-fc-col", 250, " kgf/cm²");
            setSlider("concrete-fc-beam", 250, " kgf/cm²");
            setSlider("steel-fy-col", 4200, " kgf/cm²");
            setSlider("steel-fy-beam", 4200, " kgf/cm²");

            setSlider("col-as", 33, " cm²");
            setSlider("beam-as", 16, " cm²");
            setSlider("beam-as-prime", 8, " cm²");

            // Parámetros Sísmicos Vargas
            setSelect("covenin01-zone", "7"); // Zona 7 (Ao = 0.40g)
            setSelect("covenin01-soil", "S3"); // Depósitos aluviales de gran espesor (Caraballeda)
            setSelect("covenin19-soil-class", "D"); // Suelo rígido/medio (alluvial fan profundo)
            setSlider("covenin19-a0", 0.40);
            setSlider("covenin19-a1", 0.40);
            setSlider("sismo1-pga", 0.40, "g");
            setSlider("sismo2-pga", 0.60, "g");
            setCheck("double-earthquake", true);
            setSelect("sismo1-direction", "X");
            setSelect("sismo2-direction", "X");

            // Sincronizar visibilidad de paneles de masa
            const manualMassCont = document.getElementById("manual-mass-container");
            const autoMassCont = document.getElementById("auto-mass-controls");
            if (manualMassCont) manualMassCont.style.display = "none";
            if (autoMassCont) autoMassCont.style.display = "block";

            // Forzar reconstrucción de 3D, cálculos y reseteo
            resetSimulation();
            generateSpectraAndEarthquake();
        });
    }

    // Exportar a PDF
    const exportPdfBtn = document.getElementById("btn-export-pdf");
    if (exportPdfBtn) {
        exportPdfBtn.addEventListener("click", () => {
            const printDateEl = document.getElementById("print-date");
            if (printDateEl) {
                printDateEl.textContent = new Date().toLocaleString("es-VE");
            }
            updateCalculationReport();
            window.print();
        });
    }

    // Botones móviles
    const mobRun = document.getElementById("mobile-btn-run");
    if (mobRun) mobRun.addEventListener("click", toggleSimulation);
    const mobPause = document.getElementById("mobile-btn-pause");
    if (mobPause) mobPause.addEventListener("click", pauseSimulation);
    const mobReset = document.getElementById("mobile-btn-reset");
    if (mobReset) mobReset.addEventListener("click", resetSimulation);
}

// --- FÓRMULAS SÍSMICAS COVENIN 1756 ---

// Factores de corrección phi para COVENIN 1756:2001 (Tabla 6.1)
function getCorrectionFactorPhi2001(zone, soil) {
    if (soil === 'S1') {
        if (zone >= 5) return 1.00;
        if (zone === 4) return 0.90;
        if (zone === 3) return 0.85;
        if (zone === 2) return 0.80;
        return 0.75;
    } else if (soil === 'S2') {
        if (zone >= 5) return 1.00;
        if (zone === 4) return 0.95;
        if (zone === 3) return 0.90;
        if (zone === 2) return 0.85;
        return 0.80;
    } else if (soil === 'S3') {
        if (zone >= 5) return 1.00;
        if (zone === 4) return 1.00;
        if (zone === 3) return 1.00;
        if (zone === 2) return 0.90;
        return 0.85;
    } else if (soil === 'S4') {
        if (zone >= 5) return 0.90;
        if (zone === 4) return 0.95;
        if (zone === 3) return 1.00;
        if (zone === 2) return 1.00;
        return 0.90;
    }
    return 1.00;
}

// Factores de importancia alpha para COVENIN 1756-1:2019 (Sección 4.3)
function getImportanceFactor2019(useVal) {
    if (useVal === "residential") return 1.00; // Grupo B2 (General)
    if (useVal === "public") return 1.15;      // Grupo B1 (Público/Esencial)
    if (useVal === "industrial") return 1.15;  // Grupo B1 (Almacenes)
    if (useVal === "critical") return 1.30;    // Grupo A (Vital/Crítico)
    return 1.00;
}

// COVENIN 1756:2001
function getSpectrum2001(T, params) {
    const Ao = params.Ao;
    const alpha = params.alpha;
    const phi = params.phi;
    const R = params.R;
    const soil = params.soil; // 'S1', 'S2', 'S3', 'S4'

    // Tabla 7.1: Valores de beta, T* y p
    let beta, T_star, p;
    switch (soil) {
        case 'S1': beta = 2.4; T_star = 0.4; p = 1.0; break;
        case 'S2': beta = 2.6; T_star = 0.7; p = 1.0; break;
        case 'S3': beta = 2.8; T_star = 1.0; p = 1.0; break;
        case 'S4': beta = 3.0; T_star = 1.3; p = 0.8; break;
        default: beta = 2.6; T_star = 0.7; p = 1.0;
    }

    // Período característico T+
    let T_plus;
    if (R < 5) {
        T_plus = 0.1 * (R - 1);
    } else {
        T_plus = 0.4;
    }

    // Acotación de T+
    const T_o = 0.25 * T_star;
    if (T_plus < T_o) T_plus = T_o;
    if (T_plus > T_star) T_plus = T_star;

    let Ad;
    if (T < T_plus) {
        // Tramo de transición para períodos cortos (T < T+)
        // El factor de reducción varía linealmente de 1 a R: Rp = 1 + (T / T_plus) * (R - 1)
        const Rp = 1 + (T / T_plus) * (R - 1);
        
        // Espectro elástico elástico A(T) con meseta a partir de T_o
        let elasticA;
        if (T < T_o) {
            elasticA = alpha * phi * Ao * (1 + (T / T_o) * (beta - 1));
        } else {
            elasticA = alpha * phi * beta * Ao;
        }
        Ad = elasticA / Rp;
    } else if (T <= T_star) {
        // Meseta
        Ad = (alpha * phi * beta * Ao) / R;
    } else {
        // Rama descendente
        Ad = ((alpha * phi * beta * Ao) / R) * Math.pow(T_star / T, p);
    }

    // Límite inferior de diseño
    const minAd = (alpha * phi * Ao) / R;
    return Math.max(Ad, minAd);
}

// COVENIN 1756-1:2019
function getSpectrum2019(T, params) {
    const Ao = params.Ao;
    const A1 = params.A1;
    const TL = params.TL;
    const alpha = params.alpha;
    const R = params.R;
    const rho = params.rho;
    const Fi = params.Fi;
    const soilClass = params.soilClass; // 'A', 'AB', 'B', 'BC', 'C', 'CD', 'D', 'DE', 'E'

    // Factores de sitio según Clase de Sitio (Tablas 8, 9, 10 de COVENIN 1756-1:2019)
    let Fac, Fvc, Fdc, q;
    switch (soilClass) {
        case 'A': Fac = 0.80; Fvc = 0.80; Fdc = 0.85; q = 1.5; break;
        case 'AB': Fac = 0.85; Fvc = 0.85; Fdc = 0.90; q = 1.5; break;
        case 'B': Fac = 0.90; Fvc = 0.90; Fdc = 0.95; q = 1.5; break;
        case 'BC': Fac = 1.00; Fvc = 1.00; Fdc = 1.00; q = 1.7; break;
        case 'C': Fac = 1.30; Fvc = 1.40; Fdc = 1.20; q = 1.7; break;
        case 'CD': Fac = 1.60; Fvc = 1.80; Fdc = 1.40; q = 1.9; break;
        case 'D': Fac = 1.90; Fvc = 2.30; Fdc = 1.70; q = 1.9; break;
        case 'DE': Fac = 2.40; Fvc = 3.30; Fdc = 2.25; q = 2.0; break;
        case 'E': Fac = 2.70; Fvc = 3.30; Fdc = 2.65; q = 2.0; break;
        default: Fac = 1.30; Fvc = 1.40; Fdc = 1.20; q = 1.7;
    }

    const Fa = Fac;
    const Fv = Fvc;
    const Fd = Fdc;

    const AA = Fa * alpha * Ao;
    const AV = Fv * alpha * A1;
    const beta_star = 2.4; // Amplificación espectral elástica típica

    // Periodos característicos
    const TC = (1.0 / 2.4) * (AV / AA);
    const TB = 0.20 * TC;
    const TA = 0.05;
    const TD = TL * (Fd / Fv);

    // Periodo característico T+
    let T_plus;
    if (R < 5) {
        T_plus = 0.1 * (R - 1);
    } else {
        T_plus = 0.4;
    }
    // Acotación de T+
    const minT_plus = 0.25 * TC;
    if (T_plus < minT_plus) T_plus = minT_plus;
    if (T_plus > TC) T_plus = TC;

    let Ad;
    if (T <= TA) {
        Ad = (rho * Fi * AA) / 1.5;
    } else if (T < T_plus) {
        // Transición lineal
        Ad = ((rho * Fi * AA) / 1.5) * (1 + ((1.5 * beta_star) / R - 1) * ((T - TA) / (T_plus - TA)));
    } else if (T <= TC) {
        // Meseta
        Ad = (rho * Fi * beta_star * AA) / R;
    } else if (T <= TD) {
        // Rama de velocidad
        Ad = ((rho * Fi * beta_star * AA) / R) * (TC / T);
    } else {
        // Rama de desplazamiento (periodos largos)
        Ad = ((rho * Fi * beta_star * AA) / R) * (TC / TD) * Math.pow(TD / T, q);
    }

    // Límite inferior
    const minAd = 0.05 * rho * Fi * AA / R;
    return Math.max(Ad, minAd);
}

// --- GENERACIÓN DEL ACCELEROGRAMA SINTÉTICO (SISMO SUCESIVO) ---
function generateSyntheticEarthquake(T_soil, pga1, pga2, hasSecond) {
    const N_steps = totalDuration / dt;
    groundAccel = new Array(N_steps).fill(0);

    // --- Filtro de Kanai-Tajimi reutilizable ---
    // Recibe un array de ruido blanco y devuelve la señal filtrada normalizada
    function kanaiTajimiFilter(noise, omega_g, zeta_g) {
        const len = noise.length;
        const beta_nw = 0.25, gamma_nw = 0.5;
        let x_f = 0, v_f = 0, a_f = 0;
        const result = new Array(len);

        for (let i = 0; i < len; i++) {
            let x_pred = x_f + dt * v_f + dt * dt * (0.5 - beta_nw) * a_f;
            let v_pred = v_f + dt * (1.0 - gamma_nw) * a_f;
            let a_new = noise[i] - 2.0 * zeta_g * omega_g * v_pred - omega_g * omega_g * x_pred;
            x_f = x_pred + beta_nw * dt * dt * a_new;
            v_f = v_pred + gamma_nw * dt * a_new;
            a_f = a_new;
            result[i] = 2.0 * zeta_g * omega_g * v_f + omega_g * omega_g * x_f;
        }

        // Normalizar
        let maxVal = 0;
        for (let i = 0; i < len; i++) {
            const absVal = Math.abs(result[i]);
            if (absVal > maxVal) maxVal = absVal;
        }
        if (maxVal > 0) {
            for (let i = 0; i < len; i++) result[i] /= maxVal;
        }
        return result;
    }

    // --- Generar dos señales de ruido blanco INDEPENDIENTES ---
    function generateWhiteNoise(length) {
        const w = new Array(length);
        for (let i = 0; i < length; i++) {
            let u1 = Math.random();
            let u2 = Math.random();
            w[i] = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);
        }
        return w;
    }

    const omega_g = (2.0 * Math.PI) / T_soil;
    const zeta_g = 0.6;

    // Señal 1: Para el primer sismo
    const w1 = generateWhiteNoise(N_steps);
    const filtered1 = kanaiTajimiFilter(w1, omega_g, zeta_g);

    // Señal 2: Para el segundo sismo (ruido independiente → contenido frecuencial distinto)
    const w2 = generateWhiteNoise(N_steps);
    const filtered2 = kanaiTajimiFilter(w2, omega_g, zeta_g);

    // Modulación mediante envolventes de Jennings
    // Sismo 1: t = 0 a 30s
    // Sismo 2: t = 40 a 70s (señal independiente)
    for (let i = 0; i < N_steps; i++) {
        let t = i * dt;
        let env1 = 0;
        let env2 = 0;

        // Envolvente Sismo 1
        if (t >= 0 && t < 30) {
            let t1 = 2.0;
            let t2 = 10.0;
            if (t < t1) {
                env1 = Math.pow(t / t1, 2);
            } else if (t <= t2) {
                env1 = 1.0;
            } else {
                env1 = Math.exp(-0.15 * (t - t2));
            }
        }

        // Envolvente Sismo 2
        if (hasSecond && t >= 40 && t < 75) {
            let t_local = t - 40;
            let t1 = 2.5;
            let t2 = 12.0;
            if (t_local < t1) {
                env2 = Math.pow(t_local / t1, 2);
            } else if (t_local <= t2) {
                env2 = 1.0;
            } else {
                env2 = Math.exp(-0.12 * (t_local - t2));
            }
        }

        // Combinar sismos con señales INDEPENDIENTES multiplicadas por su respectivo PGA
        groundAccel[i] = (filtered1[i] * env1 * pga1) + (filtered2[i] * env2 * pga2);
    }
}

// --- CÁLCULO DETALLADO DE PESOS Y CARGAS SÍSMICAS (COVENIN 1756) ---
function getDetailedWeightBreakdown() {
    const numColsX = parseInt(document.getElementById("num-cols-x").value) || 2;
    const numColsY = parseInt(document.getElementById("num-cols-y").value) || 2;
    const sX = parseFloat(document.getElementById("col-dist-x").value) || 5.0;
    const sY = parseFloat(document.getElementById("col-dist-y").value) || 5.0;
    const storyHeight = parseFloat(document.getElementById("story-height").value) || 3.0;

    const bW = sX * (numColsX - 1);
    const bD = sY * (numColsY - 1);
    const area = bW * bD;

    // Dimensiones de columnas y vigas para el cálculo de peso propio
    let colW = 0.35, colD = 0.35, beamW = 0.30, beamH = 0.45; // defaults
    const customSections = document.getElementById("custom-sections-enable").checked;
    if (customSections) {
        colW = (parseFloat(document.getElementById("col-width").value) || 35) / 100;
        colD = (parseFloat(document.getElementById("col-depth").value) || 35) / 100;
        beamW = (parseFloat(document.getElementById("beam-width").value) || 30) / 100;
        beamH = (parseFloat(document.getElementById("beam-depth").value) || 45) / 100;
    } else {
        colW = 0.30; colD = 0.30; beamW = 0.25; beamH = 0.40;
    }

    // 1. Peso propio de Losa
    const slabThickness = (parseFloat(document.getElementById("slab-thickness").value) || 20) / 100;
    const w_slab = area * slabThickness * 2400.0; // en kgf

    // 2. Peso propio de Columnas
    const numCols = numColsX * numColsY;
    const w_cols = numCols * (colW * colD) * storyHeight * 2400.0; // en kgf

    // 3. Peso propio de Vigas
    const w_beams_x = numColsY * bW * (beamW * beamH) * 2400.0;
    const w_beams_y = numColsX * bD * (beamW * beamH) * 2400.0;
    const w_beams = w_beams_x + w_beams_y;

    // 4. Carga Muerta Adicional
    const extraDL = parseFloat(document.getElementById("extra-dead-load").value) || 250.0;
    const w_extraDL = area * extraDL;

    // Peso permanente total (D)
    const deadLoad = w_slab + w_cols + w_beams + w_extraDL;

    // 5. Carga Variable (L)
    const use = document.getElementById("building-use").value;
    let liveLoadVal = 175.0; // residencial/oficina
    let alpha = 0.25;
    if (use === 'public') {
        liveLoadVal = 300.0;
        alpha = 0.50;
    } else if (use === 'industrial') {
        liveLoadVal = 500.0;
        alpha = 0.50;
    } else if (use === 'critical') {
        liveLoadVal = 300.0;
        alpha = 0.50;
    }
    const w_liveLoad = area * liveLoadVal;

    // Combinación sísmica: W = D + alpha * L
    const w_seismic = deadLoad + alpha * w_liveLoad;
    const mass = w_seismic / 1000.0; // en toneladas

    return {
        area,
        w_slab,
        w_cols,
        w_beams,
        w_extraDL,
        deadLoad,
        liveLoadVal,
        w_liveLoad,
        alpha,
        w_seismic,
        mass,
        slabThickness,
        extraDL
    };
}

function getCalculatedStoryMass() {
    const autoMass = document.getElementById("auto-mass").checked;
    if (!autoMass) {
        return parseFloat(document.getElementById("story-mass").value) || 100.0;
    }
    return getDetailedWeightBreakdown().mass;
}

class BuildingModel {
    constructor(N, storyHeight, storyMass, targetT1, designAdX, designAdY, analysisMode, degSeverity, numColsX, numColsY, sX, sY, customSections, codeYear) {
        this.N = N;
        this.h = storyHeight;
        this.m_ref = storyMass * 1000;
        this.analysisMode = analysisMode;
        this.degSeverity = degSeverity;
        this.numCols = (numColsX || 2) * (numColsY || 2);

        this.codeYear = codeYear || 2001;
        this.driftCollapseLimit = (codeYear === 2019) ? 0.045 : 0.035;
        this.effDegSeverity = (codeYear === 2019) ? degSeverity * 0.5 : degSeverity;

        const sX_val = sX || 5.0;
        const sY_val = sY || 5.0;
        const bW = sX_val * ((numColsX || 2) - 1);
        const bD = sY_val * ((numColsY || 2) - 1);
        const area = bW * bD;
        const rp = Math.sqrt((bW * bW + bD * bD) / 12) || 2.0;

        // Corrección de masa por área tributaria:
        // Para un edificio de referencia de 25 m² (5m×5m, 4 columnas), el factor es 1.0.
        // Para edificios más grandes, la masa crece proporcionalmente al área de planta.
        // El término 0.3 representa la masa mínima estructural (columnas, vigas, acabados fijos)
        const autoMassCheck = document.getElementById("auto-mass") ? document.getElementById("auto-mass").checked : true;
        this.m = autoMassCheck ? this.m_ref : this.m_ref * (0.3 + 0.7 * (area / 25.0));

        const CONV = 98066.5;
        const ES_PA = 2.0e6 * CONV;

        // --- VERIFICACIÓN COLUMNA FUERTE – VIGA DÉBIL (SCWB) ---
        // Solo aplicable cuando se definen secciones personalizadas
        this.scwbRatio = Infinity; // Por defecto, se asume diseño correcto
        this.strongColumnWeakBeam = true;
        this.Mn_beam = 0;  // Momento nominal de la viga (kgf·m)
        this.Mn_col = 0;   // Momento nominal de la columna (kgf·m)

        if (customSections && customSections.enable) {
            const fc_col = customSections.fcCol;
            const fc_beam = customSections.fcBeam;
            const fy_col = customSections.fyCol;
            const fy_beam = customSections.fyBeam;
            const Ec_col = 15100.0 * Math.sqrt(fc_col) * CONV;
            const Ec_beam = 15100.0 * Math.sqrt(fc_beam) * CONV;

            const bc_x = customSections.colWidth / 100;
            const hc_x = customSections.colDepth / 100;
            const Ic_gross_x = (bc_x * Math.pow(hc_x, 3)) / 12;

            const n_col = ES_PA / Ec_col;
            const As_col_m2 = (customSections.colAs) / 1e4;
            const d_cover_col = 0.04;
            const arm_col_x = hc_x / 2 - d_cover_col;
            const Ic_x = Ic_gross_x + (n_col - 1) * As_col_m2 * arm_col_x * arm_col_x;

            const n = ES_PA / Ec_beam;
            const As_m2 = (customSections.beamAs) / 1e4;
            const Asp_m2 = (customSections.beamAsPrime) / 1e4;
            const d_cover = 0.04;
            const bb = customSections.beamWidth / 100;
            const hb = customSections.beamDepth / 100;
            const d = hb - d_cover;
            const dp = d_cover;

            const A_quad = bb / 2;
            const B_quad = n * (As_m2 + Asp_m2);
            const C_quad = -n * (As_m2 * d + Asp_m2 * dp);
            const discriminant = B_quad * B_quad - 4 * A_quad * C_quad;
            const x_na = (-B_quad + Math.sqrt(Math.max(0, discriminant))) / (2 * A_quad);

            const Icr = (bb * Math.pow(x_na, 3)) / 3
                + n * Asp_m2 * Math.pow(Math.max(0, x_na - dp), 2)
                + n * As_m2 * Math.pow(Math.max(0, d - x_na), 2);

            const k_col_fixed_x = (12.0 * Ec_col * Ic_x) / Math.pow(this.h, 3);
            const kappa_x = (Ec_beam * Icr * this.h) / (2.0 * Ec_col * Ic_x * sX_val);
            const eta_x = (12.0 * kappa_x + 1.0) / (12.0 * kappa_x + 4.0);
            this.k_init_x = this.numCols * k_col_fixed_x * eta_x;

            const sinTerm = Math.sin(Math.PI / (4.0 * N + 2.0));
            this.T1_x = Math.PI / (Math.sqrt(this.k_init_x / this.m) * sinTerm);

            const bc_y = hc_x;
            const hc_y = bc_x;
            const Ic_gross_y = (bc_y * Math.pow(hc_y, 3)) / 12;
            const arm_col_y = hc_y / 2 - d_cover_col;
            const Ic_y = Ic_gross_y + (n_col - 1) * As_col_m2 * arm_col_y * arm_col_y;

            const k_col_fixed_y = (12.0 * Ec_col * Ic_y) / Math.pow(this.h, 3);
            const kappa_y = (Ec_beam * Icr * this.h) / (2.0 * Ec_col * Ic_y * sY_val);
            const eta_y = (12.0 * kappa_y + 1.0) / (12.0 * kappa_y + 4.0);
            this.k_init_y = this.numCols * k_col_fixed_y * eta_y;
            this.T1_y = Math.PI / (Math.sqrt(this.k_init_y / this.m) * sinTerm);

            // --- Cálculo de Momentos Nominales para Verificación SCWB ---

            // Momento nominal de la VIGA (sección doblemente armada):
            // Mn,viga = As × fy × (d - a/2)  donde  a = As × fy / (0.85 × f'c × b)
            const As_beam_cm2 = customSections.beamAs;
            const bb_cm = customSections.beamWidth;
            const d_cm = (customSections.beamDepth) - 4.0; // recubrimiento 4 cm
            const a_beam = (As_beam_cm2 * fy_beam) / (0.85 * fc_beam * bb_cm); // cm
            this.Mn_beam = As_beam_cm2 * fy_beam * (d_cm - a_beam / 2.0); // kgf·cm
            this.Mn_beam /= 100.0; // convertir a kgf·m

            // Momento nominal de la COLUMNA (aproximación simplificada con carga axial):
            // Pu estimada = peso tributario por columna (masa × g / numCols × N/2 pisos sobre el nudo promedio)
            const Pu_approx = (this.m * N) / this.numCols * 0.5; // kgf (carga axial promedio)
            const As_col_cm2 = customSections.colAs;
            const hc_cm = customSections.colDepth;
            const bc_cm = customSections.colWidth;
            const d_prime_col = 4.0; // recubrimiento 4 cm
            // Mn,col ≈ As_col × fy × (h/2 - d') + 0.5 × Pu × (h - 2d') × (1 - Pu/(f'c × b × h))
            const term1 = As_col_cm2 * fy_col * (hc_cm / 2.0 - d_prime_col);
            const Pu_ratio = Math.min(0.9, Pu_approx / (fc_col * bc_cm * hc_cm));
            const term2 = 0.5 * Pu_approx * (hc_cm - 2.0 * d_prime_col) * (1.0 - Pu_ratio);
            this.Mn_col = (term1 + term2) / 100.0; // kgf·m

            // Verificación SCWB en nudo interior (2 columnas, 2 vigas):
            // ΣMn,col / ΣMn,viga ≥ 1.2
            const sumMnCol = 2.0 * this.Mn_col;  // 2 columnas confluyen al nudo
            const sumMnViga = 2.0 * this.Mn_beam; // 2 vigas confluyen al nudo
            this.scwbRatio = (sumMnViga > 0) ? (sumMnCol / sumMnViga) : Infinity;
            this.strongColumnWeakBeam = (this.scwbRatio >= 1.2);

        } else {
            const phi_Sx = (60.0 + sX_val) / (60.0 + 4.0 * sX_val);
            const phi_Sy = (60.0 + sY_val) / (60.0 + 4.0 * sY_val);
            const phi_ref = 0.8125;
            const stiffnessScale_x = phi_Sx / phi_ref;
            const stiffnessScale_y = phi_Sy / phi_ref;

            const sinTerm = Math.sin(Math.PI / (4.0 * N + 2.0));
            const k_ref = this.m_ref * Math.pow(Math.PI / (targetT1 * sinTerm), 2);

            this.k_init_x = k_ref * (this.numCols / 4.0) * stiffnessScale_x;
            this.k_init_y = k_ref * (this.numCols / 4.0) * stiffnessScale_y;

            const massRatio = this.m / this.m_ref;
            const stiffnessRatio_x = (this.numCols / 4.0) * stiffnessScale_x;
            const stiffnessRatio_y = (this.numCols / 4.0) * stiffnessScale_y;

            this.T1_x = targetT1 * Math.sqrt(massRatio / stiffnessRatio_x);
            this.T1_y = targetT1 * Math.sqrt(massRatio / stiffnessRatio_y);
        }

        const eccVal = parseFloat(document.getElementById("torsional-eccentricity").value) || 0.0;
        this.torsionAmp_x = Math.sqrt(Math.pow(1.0 + (eccVal * bD) / (2.0 * rp), 2) + Math.pow((eccVal * bW) / (2.0 * rp), 2));
        this.torsionAmp_y = Math.sqrt(Math.pow(1.0 + (eccVal * bW) / (2.0 * rp), 2) + Math.pow((eccVal * bD) / (2.0 * rp), 2));

        this.x = new Array(N).fill(0);
        this.v = new Array(N).fill(0);
        this.a = new Array(N).fill(0);

        this.k = new Array(N).fill(this.k_init_x);
        this.u_p = new Array(N).fill(0);
        this.u_p_old = new Array(N).fill(0);
        this.u_max = new Array(N).fill(0);
        this.E_h = new Array(N).fill(0);
        this.D = new Array(N).fill(0);

        // --- Daño individualizado por columna ---
        // D_max: daño Park-Ang de la columna de esquina (la más solicitada por torsión)
        // u_max_corner: deformación máxima en la columna de esquina con torsión
        this.D_max = new Array(N).fill(0);
        this.u_max_corner = new Array(N).fill(0);

        this.isCollapsed = false;
        this.collapseTime = null;
        this.maxDriftRatio = 0;
        this.currentBaseShear = 0;

        const totalMass = this.m * N;
        const totalWeight = totalMass * G;
        const Omega = 1.8;

        const V_base_x = designAdX * totalWeight;
        let sum_mh = 0;
        for (let j = 0; j < N; j++) sum_mh += this.m * (j + 1) * this.h;

        const F_design_x = new Array(N);
        for (let j = 0; j < N; j++) F_design_x[j] = V_base_x * (this.m * (j + 1) * this.h) / sum_mh;

        this.V_design_x = new Array(N);
        for (let i = 0; i < N; i++) {
            let sum = 0;
            for (let j = i; j < N; j++) sum += F_design_x[j];
            this.V_design_x[i] = sum;
        }
        this.Vy_init_x = this.V_design_x.map(v => v * Omega);

        const V_base_y = designAdY * totalWeight;
        const F_design_y = new Array(N);
        for (let j = 0; j < N; j++) F_design_y[j] = V_base_y * (this.m * (j + 1) * this.h) / sum_mh;

        this.V_design_y = new Array(N);
        for (let i = 0; i < N; i++) {
            let sum = 0;
            for (let j = i; j < N; j++) sum += F_design_y[j];
            this.V_design_y[i] = sum;
        }
        this.Vy_init_y = this.V_design_y.map(v => v * Omega);

        this.Vy_init = [...this.Vy_init_x];
        this.Vy = [...this.Vy_init];
        this.uy_init = this.Vy_init.map((vy, i) => vy / this.k[i]);

        this.history = { time: [], roofDisp: [], groundDrift: [], groundShear: [] };

        const w1_x = 2.0 * Math.sqrt(this.k_init_x / this.m) * Math.sin(Math.PI / (4.0 * N + 2.0));
        const w2_x = 2.0 * Math.sqrt(this.k_init_x / this.m) * Math.sin(3.0 * Math.PI / (4.0 * N + 2.0));
        const w1_y = 2.0 * Math.sqrt(this.k_init_y / this.m) * Math.sin(Math.PI / (4.0 * N + 2.0));
        const w2_y = 2.0 * Math.sqrt(this.k_init_y / this.m) * Math.sin(3.0 * Math.PI / (4.0 * N + 2.0));

        const zeta = parseFloat(document.getElementById("damping-ratio").value);
        this.aM_x = zeta * (2.0 * w1_x * w2_x) / (w1_x + w2_x);
        this.aK_x = zeta * 2.0 / (w1_x + w2_x);
        this.aM_y = zeta * (2.0 * w1_y * w2_y) / (w1_y + w2_y);
        this.aK_y = zeta * 2.0 / (w1_y + w2_y);

        this.aM = this.aM_x;
        this.aK = this.aK_x;
        this.alpha_p = (codeYear === 2019) ? 0.03 : 0.05;
    }

    step(a_ground, activeDir) {
        if (this.isCollapsed) return;

        const isX = (activeDir === 'X');
        const torsionAmp_curr = isX ? this.torsionAmp_x : this.torsionAmp_y;

        this.aM = isX ? this.aM_x : this.aM_y;
        this.aK = isX ? this.aK_x : this.aK_y;

        const N = this.N;
        const dt2 = dt * dt;
        const beta = 0.25;
        const gamma = 0.5;

        const x_old = [...this.x];
        const v_old = [...this.v];
        const a_old = [...this.a];

        const x_pred = new Array(N);
        const v_pred = new Array(N);
        for (let i = 0; i < N; i++) {
            x_pred[i] = x_old[i] + dt * v_old[i] + dt2 * (0.5 - beta) * a_old[i];
            v_pred[i] = v_old[i] + dt * (1.0 - gamma) * a_old[i];
        }

        // Factor de protección SCWB:
        // Si Columna Fuerte–Viga Débil se cumple (ratio ≥ 1.2), las rótulas se forman
        // preferentemente en las vigas, protegiendo las columnas. Esto reduce la degradación
        // efectiva de la rigidez y resistencia del entrepiso.
        // Si no se cumple (ratio < 1.2), las columnas reciben toda la degradación (piso blando).
        const scwbProtection = this.strongColumnWeakBeam ? 0.4 : 1.0;

        const storyForces = new Array(N);
        for (let i = 0; i < N; i++) {
            const x_i = x_pred[i];
            const x_prev = (i === 0) ? 0 : x_pred[i - 1];
            const u = x_i - x_prev;
            const up = this.u_p[i];

            const k_init_floor_i = isX ? this.k_init_x : this.k_init_y;
            const vy_init_floor_i = isX ? this.Vy_init_x[i] : this.Vy_init_y[i];

            // Degradación modulada por la protección SCWB:
            // scwbProtection = 0.4 si SCWB se cumple (las columnas se degradan 60% menos)
            // scwbProtection = 1.0 si SCWB no se cumple (degradación completa en columnas)
            const k_deg_factor = 1.0 - (0.6 * this.effDegSeverity * scwbProtection * this.D[i]);
            const vy_deg_factor = 1.0 - (0.4 * this.effDegSeverity * scwbProtection * this.D[i]);

            this.k[i] = k_init_floor_i * Math.max(0.05, k_deg_factor);
            this.Vy[i] = vy_init_floor_i * Math.max(0.1, vy_deg_factor);

            const k = this.k[i];
            const vy = this.Vy[i];

            if (this.analysisMode === 'linear') {
                storyForces[i] = k * u;
            } else {
                let f_elastic = k * (u - up);
                if (Math.abs(f_elastic) <= vy) {
                    storyForces[i] = f_elastic;
                } else {
                    const f_sign = Math.sign(f_elastic);
                    storyForces[i] = f_sign * vy + this.alpha_p * k * (u - up - f_sign * (vy / k));
                    this.u_p[i] = u - f_sign * (vy / k);
                    this.E_h[i] += Math.abs(storyForces[i] * (this.u_p[i] - this.u_p_old[i]));
                }
            }
            this.u_p_old[i] = this.u_p[i];

            // --- Daño promedio del piso (deformación sin amplificación torsional) ---
            this.u_max[i] = Math.max(this.u_max[i], Math.abs(u));

            // --- Daño de la columna de esquina (con amplificación torsional completa) ---
            this.u_max_corner[i] = Math.max(this.u_max_corner[i], Math.abs(u) * torsionAmp_curr);

            const u_ult = this.driftCollapseLimit * this.h;
            const beta_daño = 0.05 * this.effDegSeverity;

            // D[i]: índice de daño promedio del piso (para degradación del modelo dinámico)
            this.D[i] = (this.u_max[i] / u_ult) + (beta_daño * this.E_h[i]) / (vy_init_floor_i * u_ult);
            this.D[i] = Math.min(1.0, Math.max(0.0, this.D[i]));

            // D_max[i]: índice de daño de la columna más solicitada (esquina con torsión)
            this.D_max[i] = (this.u_max_corner[i] / u_ult) + (beta_daño * this.E_h[i]) / (vy_init_floor_i * u_ult);
            this.D_max[i] = Math.min(1.0, Math.max(0.0, this.D_max[i]));

            // Colapso se evalúa con la columna más dañada (columna de esquina)
            const driftRatioCorner = (Math.abs(u) * torsionAmp_curr) / this.h;
            if (driftRatioCorner > this.driftCollapseLimit || this.D_max[i] >= 0.99) {
                this.isCollapsed = true;
                this.collapseTime = currentTime;
            }
        }
        this.currentBaseShear = storyForces[0];

        const f_rest = new Array(N);
        for (let i = 0; i < N; i++) {
            f_rest[i] = storyForces[i] - ((i === N - 1) ? 0 : storyForces[i + 1]);
        }

        const f_damp = new Array(N).fill(0);
        for (let i = 0; i < N; i++) {
            const v_i = v_pred[i];
            const v_prev = (i === 0) ? 0 : v_pred[i - 1];
            const v_next = (i === N - 1) ? 0 : v_pred[i + 1];
            const k_i = this.k[i];
            const k_next = (i === N - 1) ? 0 : this.k[i + 1];
            f_damp[i] = this.aM * this.m * v_i + this.aK * (k_i * (v_i - v_prev) - k_next * (v_next - v_i));
        }

        const a_new = new Array(N);
        for (let i = 0; i < N; i++) a_new[i] = -a_ground * G - (f_damp[i] + f_rest[i]) / this.m;

        for (let i = 0; i < N; i++) {
            this.x[i] = x_pred[i] + beta * dt2 * a_new[i];
            this.v[i] = v_pred[i] + gamma * dt * a_new[i];
            this.a[i] = a_new[i];
            const u_curr = this.x[i] - ((i === 0) ? 0 : this.x[i - 1]);
            const driftRatio = (Math.abs(u_curr) * torsionAmp_curr) / this.h;
            if (driftRatio > this.maxDriftRatio) this.maxDriftRatio = driftRatio;
        }

        this.history.time.push(currentTime);
        this.history.roofDisp.push(this.x[N - 1]);
        this.history.groundDrift.push(this.x[0] / this.h);
        this.history.groundShear.push(storyForces[0]);
    }
}

// --- TABLA DE CABILLAS VENEZOLANAS (COVENIN) ---
const CABILLAS_VE = [
    { name: '3/8"', desig: 3, diam_cm: 0.953, area_cm2: 0.71 },
    { name: '1/2"', desig: 4, diam_cm: 1.27, area_cm2: 1.27 },
    { name: '5/8"', desig: 5, diam_cm: 1.588, area_cm2: 1.98 },
    { name: '3/4"', desig: 6, diam_cm: 1.905, area_cm2: 2.85 },
    { name: '7/8"', desig: 7, diam_cm: 2.222, area_cm2: 3.88 },
    { name: '1"',   desig: 8, diam_cm: 2.54,  area_cm2: 5.07 },
    { name: '1 3/8"', desig: 11, diam_cm: 3.581, area_cm2: 10.07 }
];

/**
 * Selecciona la combinación óptima de cabillas venezolanas para un área de acero requerida.
 * Verifica que las barras quepan físicamente en la sección.
 * @param {number} As_req - Área de acero requerida (cm²)
 * @param {number} bw - Ancho de la viga (cm)
 * @param {number} cover - Recubrimiento (cm), default 4.0
 * @param {number} db_st - Diámetro del estribo (cm), default 0.953 (#3)
 * @returns {{ desc: string, area: number, n: number, db: number, bars: Array }} Combinación seleccionada
 */
function selectRebarCombo(As_req, bw, cover = 4.0, db_st = 0.953) {
    const availW = bw - 2 * cover - 2 * db_st;
    const gap = 2.5; // cm separación libre mínima entre barras
    let best = null;

    // Intentar con un solo diámetro (de menor a mayor)
    for (const bar of CABILLAS_VE) {
        if (bar.desig < 4) continue; // Mín #4 (1/2") para longitudinal
        const maxFit = Math.floor((availW + gap) / (bar.diam_cm + gap));
        const nNeed = Math.ceil(As_req / bar.area_cm2);
        if (nNeed >= 2 && nNeed <= maxFit) {
            const opt = { desc: `${nNeed} Ø ${bar.name} (#${bar.desig})`, area: nNeed * bar.area_cm2, n: nNeed, db: bar.diam_cm, bars: [{ ...bar, count: nNeed }] };
            if (!best || opt.area < best.area) best = opt;
        }
    }

    // Si no cabe con un solo diámetro, probar combinación de 2 diámetros (2da capa)
    if (!best) {
        for (let i = CABILLAS_VE.length - 1; i >= 1; i--) {
            const big = CABILLAS_VE[i];
            if (big.desig < 4) continue;
            const maxBig = Math.floor((availW + gap) / (big.diam_cm + gap));
            for (let nB = Math.min(maxBig, 5); nB >= 2; nB--) {
                const areaB = nB * big.area_cm2;
                if (areaB >= As_req) continue;
                const rem = As_req - areaB;
                for (let j = CABILLAS_VE.length - 1; j >= 1; j--) {
                    const sm = CABILLAS_VE[j];
                    if (sm.desig < 4) continue;
                    const nS = Math.ceil(rem / sm.area_cm2);
                    const maxSm = Math.floor((availW + gap) / (sm.diam_cm + gap));
                    if (nS >= 1 && nS <= maxSm) {
                        const total = areaB + nS * sm.area_cm2;
                        const opt = { desc: `${nB} Ø ${big.name} + ${nS} Ø ${sm.name}`, area: total, n: nB + nS, db: big.diam_cm, bars: [{ ...big, count: nB }, { ...sm, count: nS }], twoLayers: true };
                        if (!best || total < best.area) { best = opt; }
                        break;
                    }
                }
                if (best) break;
            }
            if (best) break;
        }
    }
    return best || { desc: 'N/A (sección insuficiente)', area: 0, n: 0, db: 0, bars: [] };
}

/**
 * Genera un SVG inline con vista longitudinal, sección transversal A-A, y detalle de estribo con gancho 135°.
 */
function generateBeamSVG(bw, h, d, L_cm, cover, nBotBars, nTopBars, s_conf, s_center, h_conf, db_st, dirLabel) {
    const W = 700, H = 400;
    // -- Vista Longitudinal --
    const lx = 50, ly = 35, lw = 430, lh = 110;
    const scaleL = lw / L_cm;
    const confPx = Math.min(h_conf * scaleL, lw * 0.35);
    const sConfPx = Math.max(s_conf * scaleL, 3);
    const sCenterPx = Math.max(s_center * scaleL, 6);
    const colStub = 18;
    const btY = ly + 10, bbY = ly + lh - 10;

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;background:rgba(0,0,0,0.35);border-radius:10px;border:1px solid rgba(255,255,255,0.08);margin:12px 0;">
    <style>
        .bf{fill:rgba(120,130,140,0.13);stroke:#8899aa;stroke-width:1.4}
        .bl{stroke:#ff6b6b;stroke-width:2.2;stroke-linecap:round}
        .bc{fill:#ff6b6b;stroke:#fff;stroke-width:.5}
        .bct{fill:#ff9f43;stroke:#fff;stroke-width:.5}
        .sl{stroke:#00f2fe;stroke-width:.9;opacity:.85}
        .sr{fill:none;stroke:#00f2fe;stroke-width:1.6}
        .cz{fill:rgba(255,107,107,0.07)}
        .dl{stroke:#666;stroke-width:.5;stroke-dasharray:3,2}
        .dt{fill:#999;font:600 8.5px 'Inter',sans-serif;text-anchor:middle}
        .lt{fill:#fff;font:600 10px 'Inter',sans-serif}
        .st{fill:#aaa;font:400 7.5px 'Inter',sans-serif}
        .tt{fill:#ffb703;font:700 10.5px 'Inter',sans-serif;text-anchor:middle}
        .hl{stroke:#00f2fe;stroke-width:1.6;fill:none;stroke-linecap:round}
        .cf{fill:rgba(255,183,3,0.1);stroke:#ffb703;stroke-width:1;stroke-dasharray:4,2}
    </style>`;

    // Título dirección
    svg += `<text x="${lx+lw/2}" y="16" class="tt">${dirLabel}</text>`;

    // Vista longitudinal
    svg += `<text x="${lx+lw/2}" y="${ly-6}" class="tt" font-size="9">VISTA LONGITUDINAL</text>`;
    // Columnas
    svg += `<rect x="${lx-colStub}" y="${ly-5}" width="${colStub}" height="${lh+10}" class="cf" rx="2"/>`;
    svg += `<rect x="${lx+lw}" y="${ly-5}" width="${colStub}" height="${lh+10}" class="cf" rx="2"/>`;
    // Viga
    svg += `<rect x="${lx}" y="${ly}" width="${lw}" height="${lh}" class="bf" rx="1"/>`;
    // Zonas confinadas
    svg += `<rect x="${lx}" y="${ly}" width="${confPx}" height="${lh}" class="cz"/>`;
    svg += `<rect x="${lx+lw-confPx}" y="${ly}" width="${confPx}" height="${lh}" class="cz"/>`;
    // Barras longitudinales
    svg += `<line x1="${lx}" y1="${btY}" x2="${lx+lw}" y2="${btY}" class="bl"/>`;
    svg += `<line x1="${lx}" y1="${bbY}" x2="${lx+lw}" y2="${bbY}" class="bl"/>`;
    // Etiquetas barras
    svg += `<text x="${lx+lw/2}" y="${btY-4}" class="st" text-anchor="middle">As' (compresión)</text>`;
    svg += `<text x="${lx+lw/2}" y="${bbY+11}" class="st" text-anchor="middle">As (tracción)</text>`;

    // Estribos
    let x = lx + Math.max(4, 5 * scaleL);
    while (x < lx + confPx) { svg += `<line x1="${x}" y1="${ly+4}" x2="${x}" y2="${ly+lh-4}" class="sl"/>`; x += sConfPx; }
    while (x < lx + lw - confPx) { svg += `<line x1="${x}" y1="${ly+4}" x2="${x}" y2="${ly+lh-4}" class="sl" opacity=".5"/>`; x += sCenterPx; }
    while (x < lx + lw - 4) { svg += `<line x1="${x}" y1="${ly+4}" x2="${x}" y2="${ly+lh-4}" class="sl"/>`; x += sConfPx; }

    // Corte A-A indicador
    const cutX = lx + lw * 0.28;
    svg += `<line x1="${cutX}" y1="${ly-8}" x2="${cutX}" y2="${ly+lh+8}" stroke="#ffb703" stroke-width=".7" stroke-dasharray="6,3"/>`;
    svg += `<text x="${cutX-7}" y="${ly-10}" fill="#ffb703" font-size="8" font-family="Inter" font-weight="bold">A</text>`;
    svg += `<text x="${cutX+3}" y="${ly+lh+16}" fill="#ffb703" font-size="8" font-family="Inter" font-weight="bold">A</text>`;

    // Cotas - zona confinada izquierda
    const dY = ly + lh + 22;
    svg += `<line x1="${lx}" y1="${dY}" x2="${lx+confPx}" y2="${dY}" class="dl"/>`;
    svg += `<line x1="${lx}" y1="${dY-4}" x2="${lx}" y2="${dY+4}" class="dl"/>`;
    svg += `<line x1="${lx+confPx}" y1="${dY-4}" x2="${lx+confPx}" y2="${dY+4}" class="dl"/>`;
    svg += `<text x="${lx+confPx/2}" y="${dY+12}" class="dt">2h=${(2*h/100).toFixed(2)}m</text>`;
    svg += `<text x="${lx+confPx/2}" y="${dY+22}" class="st" text-anchor="middle">s=${s_conf.toFixed(0)}cm</text>`;
    // Zona central
    const cS = lx + confPx, cE = lx + lw - confPx;
    svg += `<line x1="${cS}" y1="${dY}" x2="${cE}" y2="${dY}" class="dl"/>`;
    svg += `<text x="${(cS+cE)/2}" y="${dY+12}" class="dt">Zona central</text>`;
    svg += `<text x="${(cS+cE)/2}" y="${dY+22}" class="st" text-anchor="middle">s=${s_center.toFixed(0)}cm</text>`;
    // Zona confinada derecha
    svg += `<line x1="${cE}" y1="${dY}" x2="${lx+lw}" y2="${dY}" class="dl"/>`;
    svg += `<line x1="${cE}" y1="${dY-4}" x2="${cE}" y2="${dY+4}" class="dl"/>`;
    svg += `<line x1="${lx+lw}" y1="${dY-4}" x2="${lx+lw}" y2="${dY+4}" class="dl"/>`;
    svg += `<text x="${(cE+lx+lw)/2}" y="${dY+12}" class="dt">2h</text>`;
    // Cota total
    const tDY = dY + 33;
    svg += `<line x1="${lx}" y1="${tDY}" x2="${lx+lw}" y2="${tDY}" class="dl"/>`;
    svg += `<line x1="${lx}" y1="${tDY-4}" x2="${lx}" y2="${tDY+4}" class="dl"/>`;
    svg += `<line x1="${lx+lw}" y1="${tDY-4}" x2="${lx+lw}" y2="${tDY+4}" class="dl"/>`;
    svg += `<text x="${lx+lw/2}" y="${tDY+13}" class="dt">L = ${(L_cm/100).toFixed(2)} m</text>`;

    // -- Sección Transversal A-A --
    const secScale = Math.min(120 / bw, 170 / h) * 0.75;
    const sw = bw * secScale, sh = h * secScale;
    const sx = 540, sy = 30;
    const scx = sx + 70, scy = sy + 90;
    const rx = scx - sw/2, ry = scy - sh/2;
    const covPx = cover * secScale, stPx = db_st * secScale;

    svg += `<text x="${scx}" y="${sy+4}" class="tt" font-size="9">SECCIÓN A-A</text>`;
    svg += `<rect x="${rx}" y="${ry}" width="${sw}" height="${sh}" class="bf" rx="2"/>`;
    // Estribo
    const esx = rx + covPx, esy = ry + covPx, esw = sw - 2*covPx, esh = sh - 2*covPx;
    svg += `<rect x="${esx}" y="${esy}" width="${esw}" height="${esh}" class="sr" rx="3"/>`;
    // Ganchos 135° (esquinas superiores)
    const hkL = 10;
    svg += `<line x1="${esx}" y1="${esy+3}" x2="${esx+hkL*.71}" y2="${esy+3+hkL*.71}" class="hl"/>`;
    svg += `<line x1="${esx+esw}" y1="${esy+3}" x2="${esx+esw-hkL*.71}" y2="${esy+3+hkL*.71}" class="hl"/>`;
    // Ganchos 135° (esquinas inferiores)
    svg += `<line x1="${esx}" y1="${esy+esh-3}" x2="${esx+hkL*.71}" y2="${esy+esh-3-hkL*.71}" class="hl"/>`;
    svg += `<line x1="${esx+esw}" y1="${esy+esh-3}" x2="${esx+esw-hkL*.71}" y2="${esy+esh-3-hkL*.71}" class="hl"/>`;

    // Barras inferiores (tracción)
    const r = Math.max(3.5, 5 * secScale / h);
    const botCy = ry + sh - covPx - stPx - r - 1;
    const bStartX = esx + r + 3, bEndX = esx + esw - r - 3;
    const bSpacing = nBotBars > 1 ? (bEndX - bStartX) / (nBotBars - 1) : 0;
    for (let i = 0; i < nBotBars; i++) {
        const cx = nBotBars === 1 ? (bStartX + bEndX)/2 : bStartX + i * bSpacing;
        svg += `<circle cx="${cx}" cy="${botCy}" r="${r}" class="bc"/>`;
    }
    // Barras superiores (compresión)
    const topCy = ry + covPx + stPx + r + 1;
    const tSpacing = nTopBars > 1 ? (bEndX - bStartX) / (nTopBars - 1) : 0;
    for (let i = 0; i < nTopBars; i++) {
        const cx = nTopBars === 1 ? (bStartX + bEndX)/2 : bStartX + i * tSpacing;
        svg += `<circle cx="${cx}" cy="${topCy}" r="${r}" class="bct"/>`;
    }

    // Cotas de sección
    svg += `<line x1="${rx}" y1="${ry+sh+12}" x2="${rx+sw}" y2="${ry+sh+12}" class="dl"/>`;
    svg += `<text x="${scx}" y="${ry+sh+22}" class="dt">${bw} cm</text>`;
    svg += `<text x="${rx+sw+14}" y="${scy+3}" class="dt" text-anchor="start" transform="rotate(-90,${rx+sw+14},${scy})">${h} cm</text>`;
    // Recubrimiento
    svg += `<text x="${rx+covPx/2}" y="${scy}" class="st" text-anchor="middle" transform="rotate(-90,${rx+covPx/2},${scy})">${cover}cm</text>`;

    // -- Detalle de Estribo --
    const dx = sx + 10, dy = sy + sh * secScale + 130;
    svg += `<text x="${dx+55}" y="${dy-5}" class="tt" font-size="9">DETALLE ESTRIBO</text>`;
    svg += `<text x="${dx+55}" y="${dy+7}" class="st" text-anchor="middle">Gancho sísmico 135°</text>`;
    const dex = dx + 5, dey = dy + 16, dew = 100, deh = 55;
    svg += `<rect x="${dex}" y="${dey}" width="${dew}" height="${deh}" class="sr" rx="5"/>`;
    const hk = 16;
    // 4 ganchos en cada esquina
    svg += `<line x1="${dex}" y1="${dey+4}" x2="${dex+hk*.71}" y2="${dey+4+hk*.71}" class="hl"/>`;
    svg += `<line x1="${dex+dew}" y1="${dey+4}" x2="${dex+dew-hk*.71}" y2="${dey+4+hk*.71}" class="hl"/>`;
    svg += `<line x1="${dex}" y1="${dey+deh-4}" x2="${dex+hk*.71}" y2="${dey+deh-4-hk*.71}" class="hl"/>`;
    svg += `<line x1="${dex+dew}" y1="${dey+deh-4}" x2="${dex+dew-hk*.71}" y2="${dey+deh-4-hk*.71}" class="hl"/>`;
    svg += `<text x="${dex+dew+10}" y="${dey+18}" class="st" text-anchor="start">135°</text>`;
    svg += `<text x="${dex+dew+10}" y="${dey+30}" class="st" text-anchor="start">Ext: 6d_b</text>`;
    svg += `<text x="${dex+dew/2}" y="${dey+deh+14}" class="dt">Estribo #3 (3/8")</text>`;

    // Leyenda
    svg += `<rect x="12" y="${H-28}" width="9" height="9" class="cz" stroke="#ff6b6b" stroke-width=".6"/>`;
    svg += `<text x="24" y="${H-20}" class="st">Zona Confinada (2h)</text>`;
    svg += `<line x1="120" y1="${H-24}" x2="135" y2="${H-24}" class="sl"/>`;
    svg += `<text x="140" y="${H-20}" class="st" text-anchor="start">Estribos</text>`;
    svg += `<line x1="186" y1="${H-24}" x2="201" y2="${H-24}" class="bl"/>`;
    svg += `<text x="206" y="${H-20}" class="st" text-anchor="start">Acero Long.</text>`;
    svg += `<circle cx="268" cy="${H-24}" r="3" class="bc"/><text x="276" y="${H-20}" class="st" text-anchor="start">Tracción</text>`;
    svg += `<circle cx="324" cy="${H-24}" r="3" class="bct"/><text x="332" y="${H-20}" class="st" text-anchor="start">Compresión</text>`;

    svg += `</svg>`;
    return svg;
}

/**
 * Renderiza la visualización 3D isométrica de la viga después de la simulación sísmica.
 * Muestra la deformación real bajo el sismo simulado (no de diseño), con código de colores
 * por daño, grietas de flexión, rótulas plásticas, y diagrama de momentos.
 *
 * @param {string} canvasId - ID del canvas donde dibujar
 * @param {object} beamData - Resultados de computeBeamDesign (beamX o beamY)
 * @param {object} model2001 - Instancia BuildingModel COVENIN 2001
 * @param {object} model2019 - Instancia BuildingModel COVENIN 2019
 * @param {object} structConf - { nBaysX, nBaysY, numColsX, numColsY, sX, sY, storyHeight, h_story_cm }
 * @param {string} dirLabel - 'X' o 'Y'
 */
function renderBeam3DCanvas(canvasId, beamData, model2001, model2019, structConf, dirLabel) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const baseW = 780;
    const baseH = 420;
    const dpr = window.devicePixelRatio || 1;

    // Configurar el backing store de forma única si no coincide con dpr
    if (canvas.width !== Math.round(baseW * dpr) || canvas.height !== Math.round(baseH * dpr)) {
        canvas.width = Math.round(baseW * dpr);
        canvas.height = Math.round(baseH * dpr);
        const ctx = canvas.getContext('2d');
        ctx.resetTransform();
        ctx.scale(dpr, dpr);
    }

    // Inicializar listener de eventos de mouse solo una vez por canvas
    if (!canvas.dataset.hasEvents) {
        canvas.dataset.hasEvents = 'true';
        canvas.dataset.isDragging = 'false';

        // Prevenir context menu para permitir drag con botón derecho
        canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        canvas.addEventListener('mousedown', (e) => {
            canvas.dataset.isDragging = 'true';
            canvas.dataset.dragButton = e.button; // 0 para izquierdo, 2 para derecho
            canvas.dataset.startX = e.clientX;
            canvas.dataset.startY = e.clientY;
        });

        canvas.addEventListener('mousemove', (e) => {
            const rect = canvas.getBoundingClientRect();
            // Convertir coordenadas de mouse de CSS a espacio lógico 780x420
            const mouseX = (e.clientX - rect.left) * (baseW / rect.width);
            const mouseY = (e.clientY - rect.top) * (baseH / rect.height);

            // Forzar redibujo inmediato
            if (canvas.dataset.isDragging === 'true') {
                const deltaX = e.clientX - parseFloat(canvas.dataset.startX);
                const deltaY = e.clientY - parseFloat(canvas.dataset.startY);

                const isPan = (canvas.dataset.dragButton === '2') || e.shiftKey;

                if (isPan) {
                    // Acción de Panning (traslación)
                    beamPanX[dirLabel] += deltaX * 0.8;
                    beamPanY[dirLabel] += deltaY * 0.8;
                } else {
                    // Acción de Rotación (orbitar)
                    beamRotY[dirLabel] += deltaX * 0.008;
                    beamRotX[dirLabel] = Math.max(-1.2, Math.min(1.2, beamRotX[dirLabel] - deltaY * 0.008));
                }

                canvas.dataset.startX = e.clientX;
                canvas.dataset.startY = e.clientY;

                // Ocultar hover mientras se arrastra
                if (dirLabel === 'X') hoverBeamX_t = null;
                else hoverBeamY_t = null;
            } else {
                // Detección de hover (proyectar mouse sobre la viga centro)
                const ox = 30;
                const oy2001 = 40; // coordenada vertical base (y=0) para 2001
                const oy2019 = -80; // y=0 para 2019
                const beamLenDraw = 300;
                const beamHDraw = 40;
                const beamWDraw = 20;

                const rotX = beamRotX[dirLabel];
                const rotY = beamRotY[dirLabel];
                const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
                const cosY = Math.cos(rotY), sinY = Math.sin(rotY);

                // Proyectar un punto 3D con rotación
                function project3D(x, y, z) {
                    const cx = beamLenDraw / 2;
                    const cy = beamHDraw / 2;
                    const cz = beamWDraw / 2;

                    // Trasladar al origen de rotación
                    let px = x - cx;
                    let py = y - cy;
                    let pz = z - cz;

                    // Rotar en Y (yaw)
                    let x1 = px * cosY - pz * sinY;
                    let z1 = px * sinY + pz * cosY;

                    // Rotar en X (pitch)
                    let y2 = py * cosX - z1 * sinX;
                    let z2 = py * sinX + z1 * cosX;

                    // Trasladar de vuelta
                    const rx = x1 + cx;
                    const ry = y2 + cy;
                    const rz = z2 + cz;

                    // Proyección isométrica estándar
                    const isoAngle = Math.PI / 6;
                    return {
                        sx: (rx - rz) * Math.cos(isoAngle),
                        sy: (rx + rz) * Math.sin(isoAngle) - ry
                    };
                }

                const centerX = baseW * 0.38;
                const centerY = baseH * 0.52;

                let bestT = null;
                let activeModel = null;

                for (const modelKey of ['2001', '2019']) {
                    const oy = (modelKey === '2001') ? oy2001 : oy2019;

                    // Línea central original de la viga
                    const pStart = project3D(ox, oy + beamHDraw / 2, beamWDraw / 2);
                    const pEnd = project3D(ox + beamLenDraw, oy + beamHDraw / 2, beamWDraw / 2);

                    const ax = centerX + pStart.sx;
                    const ay = centerY + pStart.sy;
                    const bx = centerX + pEnd.sx;
                    const by = centerY + pEnd.sy;

                    const dx = bx - ax;
                    const dy = by - ay;
                    const len2 = dx * dx + dy * dy;
                    let t = 0;
                    if (len2 > 0) {
                        t = ((mouseX - ax) * dx + (mouseY - ay) * dy) / len2;
                    }
                    t = Math.max(0, Math.min(1, t));

                    const projX = ax + t * dx;
                    const projY = ay + t * dy;

                    const dist = Math.hypot(mouseX - projX, mouseY - projY);
                    if (dist < 35) {
                        bestT = t;
                        activeModel = modelKey;
                        break;
                    }
                }

                if (dirLabel === 'X') {
                    hoverBeamX_t = bestT !== null ? { t: bestT, model: activeModel, mx: mouseX, my: mouseY } : null;
                } else {
                    hoverBeamY_t = bestT !== null ? { t: bestT, model: activeModel, mx: mouseX, my: mouseY } : null;
                }
            }

            // Redibujo inmediato si la animación está inactiva
            if (!beamAnimActive) {
                draw();
            }
        });

        const stopDrag = () => {
            canvas.dataset.isDragging = 'false';
        };
        canvas.addEventListener('mouseup', stopDrag);
        canvas.addEventListener('mouseleave', () => {
            stopDrag();
            if (dirLabel === 'X') hoverBeamX_t = null;
            else hoverBeamY_t = null;

            if (!beamAnimActive) {
                draw();
            }
        });
    }

    const ctx = canvas.getContext('2d');
    const W = baseW;
    const H = baseH;

    function draw() {
        const dpr = window.devicePixelRatio || 1;
        ctx.save();
        ctx.clearRect(0, 0, W, H);

        // --- Calcular momentos REALES del sismo simulado ---
        const isX = (dirLabel === 'X');
        const nBays = isX ? structConf.nBaysX : structConf.nBaysY;
        const numParallelFrames = isX ? structConf.numColsY : structConf.numColsX;
        const h_story_m = structConf.h_story_cm / 100;

        function getPeakBaseShear(model) {
            if (!model || !model.history || !model.history.groundShear || model.history.groundShear.length === 0) return 0;
            let maxV = 0;
            for (let i = 0; i < model.history.groundShear.length; i++) {
                const absV = Math.abs(model.history.groundShear[i]);
                if (absV > maxV) maxV = absV;
            }
            return maxV; // Newtons
        }

        const Vb_real_2001_N = getPeakBaseShear(model2001);
        const Vb_real_2019_N = getPeakBaseShear(model2019);
        const Vb_real_2001_kgf = Vb_real_2001_N / G;
        const Vb_real_2019_kgf = Vb_real_2019_N / G;

        const V_frame_real_2001 = Vb_real_2001_kgf / Math.max(1, numParallelFrames);
        const V_frame_real_2019 = Vb_real_2019_kgf / Math.max(1, numParallelFrames);

        const Mu_sismo_real_2001 = (V_frame_real_2001 * h_story_m) / (4 * Math.max(nBays, 1));
        const Mu_sismo_real_2019 = (V_frame_real_2019 * h_story_m) / (4 * Math.max(nBays, 1));

        const Mu_real_2001 = Mu_sismo_real_2001 + beamData.Mu_grav;
        const Mu_real_2019 = Mu_sismo_real_2019 + beamData.Mu_grav;

        // Daño del primer piso (Park-Ang)
        const D_2001 = (model2001 && model2001.D) ? model2001.D[0] : 0;
        const D_2019 = (model2019 && model2019.D) ? model2019.D[0] : 0;

        // Drift real máximo
        const drift_2001 = model2001 ? model2001.maxDriftRatio : 0;
        const drift_2019 = model2019 ? model2019.maxDriftRatio : 0;

        // DCR
        const DCR_2001 = beamData.phiMn > 0 ? Mu_real_2001 / beamData.phiMn : 999;
        const DCR_2019 = beamData.phiMn > 0 ? Mu_real_2019 / beamData.phiMn : 999;

        const collapsed_2001 = model2001 ? model2001.isCollapsed : false;
        const collapsed_2019 = model2019 ? model2019.isCollapsed : false;

        // --- PROYECCIÓN 3D ROTADA ---
        const rotX = beamRotX[dirLabel];
        const rotY = beamRotY[dirLabel];
        const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
        const cosY = Math.cos(rotY), sinY = Math.sin(rotY);

        const beamLenDraw = 300;
        const beamHDraw = 40;
        const beamWDraw = 20;
        const colStub = 35;

        const centerX = W * 0.38;
        const centerY = H * 0.52;

        function project3D(x, y, z) {
            const cx = beamLenDraw / 2;
            const cy = beamHDraw / 2;
            const cz = beamWDraw / 2;

            // Trasladar al origen de rotación
            let px = x - cx;
            let py = y - cy;
            let pz = z - cz;

            // Rotar en Y (yaw)
            let x1 = px * cosY - pz * sinY;
            let z1 = px * sinY + pz * cosY;

            // Rotar en X (pitch)
            let y2 = py * cosX - z1 * sinX;
            let z2 = py * sinX + z1 * cosX;

            // Trasladar de vuelta
            const rx = x1 + cx;
            const ry = y2 + cy;
            const rz = z2 + cz;

            // Proyección isométrica estándar (y positiva va Hacia Arriba)
            const isoAngle = Math.PI / 6;
            return {
                sx: (rx - rz) * Math.cos(isoAngle) + beamPanX[dirLabel],
                sy: (rx + rz) * Math.sin(isoAngle) - ry + beamPanY[dirLabel]
            };
        }

        // --- Funciones de color ---
        function damageColor(D) {
            if (D >= 1.0) return { r: 180, g: 20, b: 20 };
            if (D >= 0.8) return { r: 220, g: 40, b: 30 };
            if (D >= 0.5) return { r: 240, g: 140, b: 30 };
            if (D >= 0.2) return { r: 200, g: 200, b: 40 };
            return { r: 40, g: 180, b: 100 };
        }

        // Fondo
        const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
        bgGrad.addColorStop(0, '#0a0e1a');
        bgGrad.addColorStop(1, '#121626');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, W, H);

        // Grid de fondo isométrico sutil
        ctx.strokeStyle = 'rgba(100, 120, 160, 0.05)';
        ctx.lineWidth = 0.5;
        for (let g = -400; g < 800; g += 30) {
            const p1 = project3D(g, -110, -200);
            const p2 = project3D(g, -110, 400);
            ctx.beginPath();
            ctx.moveTo(centerX + p1.sx, centerY + p1.sy);
            ctx.lineTo(centerX + p2.sx, centerY + p2.sy);
            ctx.stroke();
            const p3 = project3D(-200, -110, g);
            const p4 = project3D(600, -110, g);
            ctx.beginPath();
            ctx.moveTo(centerX + p3.sx, centerY + p3.sy);
            ctx.lineTo(centerX + p4.sx, centerY + p4.sy);
            ctx.stroke();
        }

        // === FUNCIÓN: Dibujar un prisma 3D rotado ===
        function drawPrism(x, y, z, w, h, d, fillColor, strokeColor, opacity) {
            const corners = [
                project3D(x, y, z),           // 0: front-bot-left
                project3D(x + w, y, z),       // 1: front-bot-right
                project3D(x + w, y + h, z),   // 2: front-top-right
                project3D(x, y + h, z),       // 3: front-top-left
                project3D(x, y, z + d),       // 4: back-bot-left
                project3D(x + w, y, z + d),   // 5: back-bot-right
                project3D(x + w, y + h, z + d), // 6: back-top-right
                project3D(x, y + h, z + d),   // 7: back-top-left
            ];

            ctx.globalAlpha = opacity || 1.0;

            // Top face (y + h)
            ctx.beginPath();
            ctx.moveTo(centerX + corners[3].sx, centerY + corners[3].sy);
            ctx.lineTo(centerX + corners[2].sx, centerY + corners[2].sy);
            ctx.lineTo(centerX + corners[6].sx, centerY + corners[6].sy);
            ctx.lineTo(centerX + corners[7].sx, centerY + corners[7].sy);
            ctx.closePath();
            ctx.fillStyle = fillColor;
            ctx.fill();
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = 0.8;
            ctx.stroke();

            // Front face (z=0)
            ctx.beginPath();
            ctx.moveTo(centerX + corners[0].sx, centerY + corners[0].sy);
            ctx.lineTo(centerX + corners[1].sx, centerY + corners[1].sy);
            ctx.lineTo(centerX + corners[2].sx, centerY + corners[2].sy);
            ctx.lineTo(centerX + corners[3].sx, centerY + corners[3].sy);
            ctx.closePath();
            ctx.fillStyle = fillColor;
            ctx.fill();
            ctx.stroke();

            // Right face (x + w)
            ctx.beginPath();
            ctx.moveTo(centerX + corners[1].sx, centerY + corners[1].sy);
            ctx.lineTo(centerX + corners[5].sx, centerY + corners[5].sy);
            ctx.lineTo(centerX + corners[6].sx, centerY + corners[6].sy);
            ctx.lineTo(centerX + corners[2].sx, centerY + corners[2].sy);
            ctx.closePath();
            ctx.fillStyle = fillColor;
            ctx.fill();
            ctx.stroke();

            ctx.globalAlpha = 1.0;
        }

        // === FUNCIÓN: Dibujar un estribo 3D ===
        function drawStirrup(x, y, z_start, z_end, h, w, color, opacity) {
            ctx.globalAlpha = opacity || 1.0;
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.0;

            const corners = [
                project3D(x, y, z_start),
                project3D(x, y, z_end),
                project3D(x, y + h, z_end),
                project3D(x, y + h, z_start)
            ];

            ctx.beginPath();
            ctx.moveTo(centerX + corners[0].sx, centerY + corners[0].sy);
            ctx.lineTo(centerX + corners[1].sx, centerY + corners[1].sy);
            ctx.lineTo(centerX + corners[2].sx, centerY + corners[2].sy);
            ctx.lineTo(centerX + corners[3].sx, centerY + corners[3].sy);
            ctx.closePath();
            ctx.stroke();
            ctx.globalAlpha = 1.0;
        }

        // *** Dibujar para cada modelo ***
        function drawBeamForModel(D_val, DCR, Mu_real, drift, collapsed, modelLabel, modelColor, offsetX, offsetY) {
            const ox = offsetX;
            const oy = offsetY;

            // Oscilación dinámica sinusoidal si está animado
            const osc = beamAnimActive ? Math.sin(beamAnimTime + ox * 0.15 + oy * 0.25) : 1.0;
            const defScale = Math.min(drift * 1200, 32) * osc;

            // 1. STUBS DE COLUMNA en los extremos
            drawPrism(ox - colStub / 2, oy - colStub, 2, colStub, beamHDraw + colStub * 2, beamWDraw - 4,
                'rgba(65, 70, 85, 0.75)', 'rgba(150, 160, 180, 0.2)', 0.9);
            drawPrism(ox + beamLenDraw - colStub / 2, oy - colStub, 2, colStub, beamHDraw + colStub * 2, beamWDraw - 4,
                'rgba(65, 70, 85, 0.75)', 'rgba(150, 160, 180, 0.2)', 0.9);

            // 2. RENDERING DEL CUERPO DE LA VIGA
            const D_clamped = Math.min(Math.max(D_val, 0), 1);
            const segments = 24;
            const segW = beamLenDraw / segments;

            if (beamViewMode === 'solid') {
                for (let s = 0; s < segments; s++) {
                    const t = (s + 0.5) / segments;
                    const parabola = 4 * t * (1 - t);
                    const yDef = defScale * parabola;

                    const endProximity = 1 - 4 * Math.pow(t - 0.5, 2);
                    const localD = D_clamped * (0.6 + 0.4 * endProximity);
                    const col = damageColor(Math.min(localD * 1.25, 1));
                    const fillStr = `rgba(${col.r}, ${col.g}, ${col.b}, 0.85)`;
                    const strokeStr = `rgba(${Math.round(col.r * 0.6)}, ${Math.round(col.g * 0.6)}, ${Math.round(col.b * 0.6)}, 0.35)`;

                    drawPrism(ox + s * segW, oy + yDef, 0, segW + 0.5, beamHDraw, beamWDraw,
                        fillStr, strokeStr, 1.0);
                }
            } else {
                // Modo Rayos-X
                for (let s = 0; s < segments; s++) {
                    const t = (s + 0.5) / segments;
                    const parabola = 4 * t * (1 - t);
                    const yDef = defScale * parabola;

                    drawPrism(ox + s * segW, oy + yDef, 0, segW + 0.5, beamHDraw, beamWDraw,
                        'rgba(50, 70, 100, 0.07)', 'rgba(120, 140, 180, 0.12)', 1.0);
                }

                const rCover = 4.0;
                const zMin = rCover;
                const zMax = beamWDraw - rCover;

                ctx.save();
                ctx.lineWidth = 1.8;

                ctx.strokeStyle = '#4cc9f0';
                ctx.shadowColor = '#4cc9f0';
                ctx.shadowBlur = 5;
                const nTop = Math.max(2, beamData.rebarTopPlaced.n);
                for (let i = 0; i < nTop; i++) {
                    const z = zMin + (i / (nTop - 1)) * (zMax - zMin);
                    ctx.beginPath();
                    for (let s = 0; s <= segments; s++) {
                        const t = s / segments;
                        const parabola = 4 * t * (1 - t);
                        const yDef = defScale * parabola;
                        const p = project3D(ox + t * beamLenDraw, oy + yDef + beamHDraw - rCover, z);
                        if (s === 0) ctx.moveTo(centerX + p.sx, centerY + p.sy);
                        else ctx.lineTo(centerX + p.sx, centerY + p.sy);
                    }
                    ctx.stroke();
                }

                ctx.strokeStyle = '#ff6b35';
                ctx.shadowColor = '#ff6b35';
                ctx.shadowBlur = 5;
                const nBot = Math.max(2, beamData.rebarBotPlaced.n);
                for (let i = 0; i < nBot; i++) {
                    const z = zMin + (i / (nBot - 1)) * (zMax - zMin);
                    ctx.beginPath();
                    for (let s = 0; s <= segments; s++) {
                        const t = s / segments;
                        const parabola = 4 * t * (1 - t);
                        const yDef = defScale * parabola;
                        const p = project3D(ox + t * beamLenDraw, oy + yDef + rCover, z);
                        if (s === 0) ctx.moveTo(centerX + p.sx, centerY + p.sy);
                        else ctx.lineTo(centerX + p.sx, centerY + p.sy);
                    }
                    ctx.stroke();
                }
                ctx.restore();

                const h_conf_px = 2 * beamHDraw;
                const s_conf_px = Math.max(6, beamHDraw * (beamData.s_final_2019_conf / beamData.h));
                const s_center_px = Math.max(12, beamHDraw * (beamData.s_center / beamData.h));

                let currX = 5;
                while (currX < beamLenDraw - 5) {
                    const t = currX / beamLenDraw;
                    const parabola = 4 * t * (1 - t);
                    const yDef = defScale * parabola;

                    const isConfined = (currX <= h_conf_px) || (currX >= beamLenDraw - h_conf_px);
                    const stirrupColor = isConfined ? 'rgba(0, 242, 254, 0.65)' : 'rgba(200, 210, 230, 0.3)';

                    drawStirrup(ox + currX, oy + yDef + 2, rCover - 1, beamWDraw - rCover + 1,
                        beamHDraw - 4, beamWDraw - rCover * 2 + 2, stirrupColor, 0.85);

                    currX += isConfined ? s_conf_px : s_center_px;
                }

                for (let s = 0; s < segments; s++) {
                    const t = (s + 0.5) / segments;
                    const parabola = 4 * t * (1 - t);
                    const yDef = defScale * parabola;

                    drawPrism(ox + s * segW, oy + yDef, 0, segW + 0.5, beamHDraw, beamWDraw,
                        'rgba(50, 70, 100, 0.03)', 'rgba(120, 140, 180, 0.08)', 0.25);
                }
            }

            // 3. FISURAS DE FLEXIÓN
            if (D_clamped > 0.05) {
                const numCracks = Math.floor(D_clamped * 14) + 2;
                ctx.strokeStyle = `rgba(30, 0, 0, ${Math.min(D_clamped * 0.8, 0.75)})`;

                for (let cr = 0; cr < numCracks; cr++) {
                    let crackT;
                    if (cr < numCracks * 0.45) {
                        crackT = 0.02 + (cr / (numCracks * 0.45)) * 0.22;
                    } else if (cr > numCracks * 0.55) {
                        crackT = 0.78 + ((cr - numCracks * 0.55) / (numCracks * 0.45)) * 0.2;
                    } else {
                        crackT = 0.24 + Math.random() * 0.52;
                    }

                    const crX = ox + crackT * beamLenDraw;
                    const crYDef = defScale * 4 * crackT * (1 - crackT);
                    const crackLen = beamHDraw * (0.22 + D_clamped * 0.6);
                    const crackAngle = (Math.random() - 0.5) * 0.3;

                    const p_start = project3D(crX, oy + crYDef + 2, beamWDraw * 0.25);
                    const p_end = project3D(crX + crackAngle * 8, oy + crYDef + crackLen, beamWDraw * 0.25);

                    ctx.lineWidth = 0.5 + D_clamped * 1.8;
                    ctx.beginPath();
                    ctx.moveTo(centerX + p_start.sx, centerY + p_start.sy);
                    ctx.lineTo(centerX + p_end.sx, centerY + p_end.sy);
                    ctx.stroke();
                }
            }

            // 4. RÓTULAS PLÁSTICAS
            if (DCR > 1.0) {
                const hingeRadius = 5 + Math.min((DCR - 1) * 3, 9);
                const hingeColor = collapsed ? 'rgba(220, 20, 20, 0.9)' : 'rgba(255, 110, 20, 0.85)';

                const pL = project3D(ox + 4, oy + beamHDraw / 2 + defScale * 0, beamWDraw / 2);
                ctx.beginPath();
                ctx.arc(centerX + pL.sx, centerY + pL.sy, hingeRadius, 0, Math.PI * 2);
                ctx.fillStyle = hingeColor;
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.0;
                ctx.stroke();

                const pR = project3D(ox + beamLenDraw - 4, oy + beamHDraw / 2 + defScale * 0, beamWDraw / 2);
                ctx.beginPath();
                ctx.arc(centerX + pR.sx, centerY + pR.sy, hingeRadius, 0, Math.PI * 2);
                ctx.fillStyle = hingeColor;
                ctx.fill();
                ctx.stroke();

                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.4;
                for (const p of [pL, pR]) {
                    const cx_h = centerX + p.sx;
                    const cy_h = centerY + p.sy;
                    const r2 = hingeRadius * 0.4;
                    ctx.beginPath();
                    ctx.moveTo(cx_h - r2, cy_h - r2); ctx.lineTo(cx_h + r2, cy_h + r2);
                    ctx.moveTo(cx_h + r2, cy_h - r2); ctx.lineTo(cx_h - r2, cy_h + r2);
                    ctx.stroke();
                }
            }

            // 5. DIAGRAMA DE MOMENTO real
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(0, 180, 255, 0.65)';
            ctx.lineWidth = 1.8;
            const momScale = Math.min(32, beamHDraw * 0.65);

            for (let i = 0; i <= 40; i++) {
                const t = i / 40;
                const xM = ox + t * beamLenDraw;

                const M_sismo_norm = 1.0 * (1 - 2 * Math.abs(t - 0.5));
                const M_grav_norm = 4 * t * (1 - t) * (beamData.Mu_grav / Math.max(Mu_real, 1));
                const M_total = M_sismo_norm + M_grav_norm;
                const yM = oy + beamHDraw + 8 + M_total * momScale;
                const yDef = defScale * 4 * t * (1 - t);

                const p = project3D(xM, yM + yDef * 0.3, beamWDraw + 4);
                if (i === 0) ctx.moveTo(centerX + p.sx, centerY + p.sy);
                else ctx.lineTo(centerX + p.sx, centerY + p.sy);
            }
            ctx.stroke();

            const labelP = project3D(ox + beamLenDraw / 2, oy + beamHDraw + 20, beamWDraw / 2);
            ctx.font = 'bold 11px "Inter", system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = modelColor;
            ctx.fillText(modelLabel, centerX + labelP.sx, centerY + labelP.sy);

            if (collapsed) {
                const colP = project3D(ox + beamLenDraw / 2, oy + beamHDraw + 34, beamWDraw / 2);
                ctx.font = 'bold 12px "Inter", system-ui, sans-serif';
                ctx.fillStyle = '#ff3333';
                ctx.fillText('⚠ COLAPSO', centerX + colP.sx, centerY + colP.sy);
            }
        }

        drawBeamForModel(D_2001, DCR_2001, Mu_real_2001, drift_2001, collapsed_2001,
            'COVENIN 1756:2001', '#ff6b35', 30, 40);
        drawBeamForModel(D_2019, DCR_2019, Mu_real_2019, drift_2019, collapsed_2019,
            'COVENIN 1756:2019', '#4cc9f0', 30, -80);

        // --- INTERACTIVIDAD: DIBUJAR INDICADOR DE HOVER ---
        const activeHover = (dirLabel === 'X') ? hoverBeamX_t : hoverBeamY_t;
        const isDragging = canvas.dataset.isDragging === 'true';

        if (activeHover && activeHover.model && !isDragging) {
            const hT = activeHover.t;
            const hModel = activeHover.model;
            const oy = (hModel === '2001') ? 40 : -80;
            const bModel = (hModel === '2001') ? model2001 : model2019;
            const Mu_real_model = (hModel === '2001') ? Mu_real_2001 : Mu_real_2019;
            const D_val = (hModel === '2001') ? D_2001 : D_2019;

            const osc = beamAnimActive ? Math.sin(beamAnimTime + 30 * 0.15 + oy * 0.25) : 1.0;
            const defScale = Math.min((bModel ? bModel.maxDriftRatio : 0) * 1200, 32) * osc;
            const yDef = defScale * 4 * hT * (1 - hT);

            const pBeam = project3D(30 + hT * beamLenDraw, oy + yDef + beamHDraw / 2, beamWDraw / 2);
            const bx = centerX + pBeam.sx;
            const by = centerY + pBeam.sy;

            ctx.strokeStyle = '#ffb703';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(bx, by, 4, 0, Math.PI * 2);
            ctx.stroke();

            ctx.strokeStyle = 'rgba(255, 183, 3, 0.4)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.lineTo(activeHover.mx, activeHover.my);
            ctx.stroke();
            ctx.setLineDash([]);

            const localPosM = (beamData.L_cm / 100) * hT;
            const M_sismo_norm = 1.0 * (1 - 2 * Math.abs(hT - 0.5));
            const M_grav_norm = 4 * hT * (1 - hT) * (beamData.Mu_grav / Math.max(Mu_real_model, 1));
            const localMu = (M_sismo_norm + M_grav_norm) * Mu_real_model;

            const endProximity = 1 - 4 * Math.pow(hT - 0.5, 2);
            const localD = Math.min(1.0, D_val * (0.6 + 0.4 * endProximity));

            const ttW = 160;
            const ttH = 82;
            let ttx = activeHover.mx + 12;
            let tty = activeHover.my - 40;

            if (ttx + ttW > W) ttx = activeHover.mx - ttW - 12;
            if (tty + ttH > H) tty = H - ttH - 12;
            if (tty < 10) tty = 10;

            ctx.fillStyle = 'rgba(10, 12, 22, 0.95)';
            ctx.strokeStyle = '#ffb703';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.roundRect(ttx, tty, ttW, ttH, 6);
            ctx.fill();
            ctx.stroke();

            ctx.font = 'bold 9px "Inter", sans-serif';
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'left';
            ctx.fillText(`COVENIN ${hModel} - Pos: ${localPosM.toFixed(2)}m`, ttx + 8, tty + 14);

            ctx.font = '8px "Inter", sans-serif';
            ctx.fillStyle = 'rgba(220, 230, 255, 0.7)';
            ctx.fillText(`Momento Sísmico: ${Math.round(localMu).toLocaleString()} kgf·m`, ttx + 8, tty + 28);
            ctx.fillText(`Capacidad φMn: ${Math.round(beamData.phiMn).toLocaleString()} kgf·m`, ttx + 8, tty + 40);
            ctx.fillText(`DCR Local: ${(localMu / Math.max(1, beamData.phiMn)).toFixed(2)}`, ttx + 8, tty + 52);
            
            const stateText = localD >= 0.8 ? 'COLAPSO/FRACTURA' : localD >= 0.5 ? 'SEVERO' : localD >= 0.2 ? 'AGRIETADO' : 'ELÁSTICO';
            ctx.font = 'bold 8px "Inter", sans-serif';
            ctx.fillStyle = localD >= 0.5 ? '#ff3333' : localD >= 0.2 ? '#ffb703' : '#4cc9f0';
            ctx.fillText(`Estado: ${stateText} (${(localD*100).toFixed(1)}%)`, ttx + 8, tty + 66);
        }

        // --- PANEL DE MÉTRICAS ---
        const panelX = W * 0.68;
        const panelY = 16;
        const panelW = W * 0.3;
        ctx.fillStyle = 'rgba(20, 25, 45, 0.85)';
        ctx.strokeStyle = 'rgba(100, 140, 200, 0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(panelX, panelY, panelW, H - 32, 8); ctx.fill(); ctx.stroke();

        ctx.font = 'bold 11px "Inter", sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left';
        ctx.fillText('COMPORTAMIENTO REAL', panelX + 12, panelY + 22);
        ctx.font = '9px "Inter", sans-serif';
        ctx.fillStyle = 'rgba(200, 210, 230, 0.6)';
        ctx.fillText(`Sismo Simulado — Dir. ${dirLabel}`, panelX + 12, panelY + 36);

        // Línea separadora
        ctx.strokeStyle = 'rgba(100, 140, 200, 0.2)';
        ctx.beginPath();
        ctx.moveTo(panelX + 10, panelY + 44);
        ctx.lineTo(panelX + panelW - 10, panelY + 44);
        ctx.stroke();

        // Métricas por modelo
        function drawMetricRow(label, val2001, val2019, unit, y, highlight) {
            ctx.font = '9px "Inter", sans-serif';
            ctx.fillStyle = 'rgba(200, 210, 230, 0.5)';
            ctx.textAlign = 'left';
            ctx.fillText(label, panelX + 12, y);

            ctx.font = highlight ? 'bold 11px "Inter", sans-serif' : '10px "Inter", sans-serif';
            ctx.fillStyle = '#ff6b35';
            ctx.textAlign = 'right';
            ctx.fillText(val2001, panelX + panelW * 0.52, y);

            ctx.fillStyle = '#4cc9f0';
            ctx.fillText(val2019, panelX + panelW * 0.82, y);

            ctx.font = '8px "Inter", sans-serif';
            ctx.fillStyle = 'rgba(200, 210, 230, 0.35)';
            ctx.textAlign = 'left';
            ctx.fillText(unit, panelX + panelW * 0.84, y);
        }

        // Header de columnas
        let my = panelY + 62;
        ctx.font = 'bold 8px "Inter", sans-serif';
        ctx.textAlign = 'right';
        ctx.fillStyle = '#ff6b35';
        ctx.fillText('2001', panelX + panelW * 0.52, my);
        ctx.fillStyle = '#4cc9f0';
        ctx.fillText('2019', panelX + panelW * 0.82, my);
        my += 18;

        drawMetricRow('Mu real sismo', Mu_sismo_real_2001.toFixed(0), Mu_sismo_real_2019.toFixed(0), 'kgf·m', my, false);
        my += 16;
        drawMetricRow('Mu real total', Mu_real_2001.toFixed(0), Mu_real_2019.toFixed(0), 'kgf·m', my, true);
        my += 16;
        drawMetricRow('φMn capacidad', beamData.phiMn.toFixed(0), beamData.phiMn.toFixed(0), 'kgf·m', my, false);
        my += 20;

        // DCR con barra visual
        drawMetricRow('DCR', DCR_2001.toFixed(2), DCR_2019.toFixed(2), '', my, true);
        my += 8;

        // Barra DCR 2001
        const barX = panelX + 12;
        const barW = panelW - 24;
        const barH = 6;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.beginPath(); ctx.roundRect(barX, my, barW, barH, 3); ctx.fill();
        const fill2001 = Math.min(DCR_2001 / 2, 1);
        ctx.fillStyle = DCR_2001 > 1 ? 'rgba(255, 60, 40, 0.8)' : 'rgba(40, 200, 100, 0.7)';
        ctx.beginPath(); ctx.roundRect(barX, my, barW * fill2001, barH, 3); ctx.fill();
        my += barH + 4;

        // Barra DCR 2019
        ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.beginPath(); ctx.roundRect(barX, my, barW, barH, 3); ctx.fill();
        const fill2019 = Math.min(DCR_2019 / 2, 1);
        ctx.fillStyle = DCR_2019 > 1 ? 'rgba(255, 60, 40, 0.8)' : 'rgba(40, 200, 100, 0.7)';
        ctx.beginPath(); ctx.roundRect(barX, my, barW * fill2019, barH, 3); ctx.fill();
        my += barH + 16;

        // Separador
        ctx.strokeStyle = 'rgba(100, 140, 200, 0.15)';
        ctx.beginPath(); ctx.moveTo(panelX + 10, my); ctx.lineTo(panelX + panelW - 10, my); ctx.stroke();
        my += 14;

        drawMetricRow('Daño Park-Ang', D_2001.toFixed(3), D_2019.toFixed(3), '', my, false);
        my += 16;
        drawMetricRow('Deriva máx', (drift_2001 * 100).toFixed(2) + '%', (drift_2019 * 100).toFixed(2) + '%', '', my, false);
        my += 16;
        drawMetricRow('Mu diseño', beamData.Mu_total_2001.toFixed(0), beamData.Mu_total_2019.toFixed(0), 'kgf·m', my, false);
        my += 16;
        drawMetricRow('Mu sismo diseño', beamData.Mu_sismo_2001.toFixed(0), beamData.Mu_sismo_2019.toFixed(0), 'kgf·m', my, false);
        my += 20;

        // Comparación diseño vs real
        ctx.strokeStyle = 'rgba(100, 140, 200, 0.15)';
        ctx.beginPath(); ctx.moveTo(panelX + 10, my); ctx.lineTo(panelX + panelW - 10, my); ctx.stroke();
        my += 14;

        ctx.font = 'bold 9px "Inter", sans-serif';
        ctx.fillStyle = 'rgba(255, 200, 50, 0.8)';
        ctx.textAlign = 'left';
        ctx.fillText('Amplificación Real / Diseño', panelX + 12, my);
        my += 16;

        const amp2001 = beamData.Mu_sismo_2001 > 0 ? (Mu_sismo_real_2001 / beamData.Mu_sismo_2001).toFixed(1) + '×' : 'N/A';
        const amp2019 = beamData.Mu_sismo_2019 > 0 ? (Mu_sismo_real_2019 / beamData.Mu_sismo_2019).toFixed(1) + '×' : 'N/A';
        drawMetricRow('Factor real/diseño', amp2001, amp2019, '', my, true);
        my += 22;

        // --- LEYENDA DE DAÑO ---
        ctx.font = 'bold 9px "Inter", sans-serif';
        ctx.fillStyle = 'rgba(200, 210, 230, 0.6)';
        ctx.textAlign = 'left';
        ctx.fillText('LEYENDA DE DAÑO', panelX + 12, my);
        my += 14;

        const legendItems = [
            { label: 'Elástico (D < 0.2)', color: 'rgb(40, 200, 100)' },
            { label: 'Fluencia (D < 0.5)', color: 'rgb(200, 200, 40)' },
            { label: 'Severo (D < 0.8)', color: 'rgb(240, 140, 30)' },
            { label: 'Colapso (D ≥ 0.8)', color: 'rgb(220, 40, 30)' },
        ];

        for (const item of legendItems) {
            ctx.fillStyle = item.color;
            ctx.beginPath();
            ctx.roundRect(panelX + 12, my - 6, 10, 10, 2);
            ctx.fill();
            ctx.font = '8px "Inter", sans-serif';
            ctx.fillStyle = 'rgba(200, 210, 230, 0.6)';
            ctx.fillText(item.label, panelX + 28, my + 2);
            my += 14;
        }

        // --- Título general arriba ---
        ctx.font = 'bold 12px "Inter", system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.textAlign = 'left';
        ctx.fillText(`Viga Dir. ${dirLabel} — Comportamiento bajo Sismo Real`, 14, 20);
        ctx.font = '10px "Inter", system-ui, sans-serif';
        ctx.fillStyle = 'rgba(200, 210, 230, 0.5)';
        ctx.fillText(`Sección: ${beamData.bw}×${beamData.h} cm  |  Luz: ${(beamData.L_cm / 100).toFixed(2)} m`, 14, 36);

        // Ícono de nota sobre sismo
        ctx.font = '8px "Inter", system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255, 200, 50, 0.5)';
        ctx.fillText('⚡ Drag izquierdo: rotar | Drag derecho o Shift: desplazar | Posicione para info.', 14, H - 10);

        ctx.restore();
    }

    // Loop de animación local
    function animLoop() {
        if (!beamAnimActive) return;
        beamAnimTime += 0.04;
        draw();
        requestAnimationFrame(animLoop);
    }

    if (beamAnimActive) {
        animLoop();
    } else {
        draw();
    }
}

/**
 * Calcula el diseño completo de una viga por teoría de rotura y genera HTML + SVG.
 * Maneja una dirección (X o Y).
 */
function computeBeamDesign(bw, h, fc, fy, As_placed, AsPrime_placed, L_cm, V_story_2001_kgf, V_story_2019_kgf, h_story_cm, nBays, numParallelFrames, s_perp_m, dirLabel) {
    const cover = 4.0; // cm
    const d = h - cover; // cm (peralte efectivo)
    const dPrime = cover; // cm
    const db_st = 0.953; // diámetro estribo #3 (cm)
    const fy_st = 2800; // kgf/cm² (fy estribos, típico ASTM A-36 liso o fy menor)

    // --- β1 ---
    let beta1 = 0.85;
    if (fc > 280) beta1 = Math.max(0.65, 0.85 - 0.05 * (fc - 280) / 70);

    // --- Cuantía balanceada y máxima ---
    const rho_b = 0.85 * beta1 * (fc / fy) * (6000 / (6000 + fy));
    const rho_max = 0.75 * rho_b; // ACI / COVENIN 1753
    const rho_min = Math.max((0.8 * Math.sqrt(fc)) / fy, 14.0 / fy);
    const As_min = rho_min * bw * d;
    const As_max = rho_max * bw * d;

    // --- Cuantía colocada ---
    const rho_placed = As_placed / (bw * d);

    // --- Capacidad nominal a flexión (Mn) - acero inferior (tracción) ---
    const a = As_placed * fy / (0.85 * fc * bw);
    const c = a / beta1;
    const Mn = As_placed * fy * (d - a / 2) / 100; // kgf·m
    const phiMn = 0.9 * Mn; // kgf·m

    // --- Capacidad por acero superior (momento negativo) ---
    const aPrime = AsPrime_placed * fy / (0.85 * fc * bw);
    const MnPrime = AsPrime_placed * fy * (d - aPrime / 2) / 100;
    const phiMnPrime = 0.9 * MnPrime;

    // --- Momento probable (Mpr) para diseño por capacidad ---
    const a_pr = As_placed * 1.25 * fy / (0.85 * fc * bw);
    const Mpr_pos = As_placed * 1.25 * fy * (d - a_pr / 2) / 100;
    const a_pr_neg = AsPrime_placed * 1.25 * fy / (0.85 * fc * bw);
    const Mpr_neg = AsPrime_placed * 1.25 * fy * (d - a_pr_neg / 2) / 100;

    // --- Demanda de momento sísmico por pórtico (Método del Portal) para 2001 y 2019 ---
    // V_frame = Cortante basal total del edificio / Número de pórticos paralelos
    // Mu_sismo por viga en nudo = V_frame × h / (4 × n_bays)
    const V_frame_2001 = V_story_2001_kgf / Math.max(1, numParallelFrames);
    const Mu_sismo_2001 = (V_frame_2001 * (h_story_cm / 100)) / (4 * Math.max(nBays, 1)); // kgf·m

    const V_frame_2019 = V_story_2019_kgf / Math.max(1, numParallelFrames);
    const Mu_sismo_2019 = (V_frame_2019 * (h_story_cm / 100)) / (4 * Math.max(nBays, 1)); // kgf·m

    // --- Demanda de momento por gravedad con área tributaria ---
    const slabThick_m = (parseFloat(document.getElementById("slab-thickness")?.value) || 20) / 100;
    const extraDL = parseFloat(document.getElementById("extra-dead-load")?.value) || 250.0;
    const beamSelfWeight_kgm = (bw / 100) * (h / 100) * 2400; // kgf/m
    const slabWeight_kgm = slabThick_m * 2400 * s_perp_m; // kgf/m tributario
    const extraDL_kgm = extraDL * s_perp_m; // kgf/m tributario
    const w_D = beamSelfWeight_kgm + slabWeight_kgm + extraDL_kgm; // Carga muerta total (kgf/m)

    // Carga viva (L) según uso
    const useType = document.getElementById("building-use")?.value || "residencial";
    let q_L = 175; // residencial default kgf/m²
    if (useType === "comercial") q_L = 300;
    else if (useType === "educativo") q_L = 250;
    const w_L = q_L * s_perp_m; // kgf/m

    // Carga combinada wu = 1.2D + 1.0L (según COVENIN sismorresistente U = 1.2D + 1.0L + E)
    const wu_total = 1.2 * w_D + 1.0 * w_L; // kgf/m
    const L_m = L_cm / 100;
    const Mu_grav = (wu_total * L_m * L_m) / 12; // kgf·m en apoyo

    const Mu_total_2001 = Mu_sismo_2001 + Mu_grav;
    const Mu_total_2019 = Mu_sismo_2019 + Mu_grav;

    // --- Verificación flexión ---
    const flexionOK_2001 = phiMn >= Mu_total_2001;
    const flexionOK_2019 = phiMn >= Mu_total_2019;
    const cuantiaOK = rho_placed >= rho_min && rho_placed <= rho_max;
    const ductilityRatio = c / d;
    const ductilityOK = ductilityRatio <= 0.375; // c/d ≤ 0.375 para sección controlada por tracción

    // --- Cortante ---
    // Vu por capacidad = (Mpr+ + Mpr-) / Ln + wu × Ln / 2
    const Ln_m = L_cm / 100;
    const Vu_cap = (Mpr_pos + Mpr_neg) / Ln_m + wu_total * Ln_m / 2; // kgf
    const Vc = 0.53 * Math.sqrt(fc) * bw * d; // kgf
    const phi_v = 0.85;
    const Vu_design = Vu_cap;
    const Vs_req = Math.max(0, Vu_design / phi_v - Vc);
    const Av = 2 * 0.71; // 2 ramas #3 = 1.42 cm²

    // Separación requerida por cortante
    const s_shear = Vs_req > 0 ? (Av * fy * d / Vs_req) : 999;

    // --- Estribos zona confinada (COVENIN 1756:2001) ---
    const db_long_placed = Math.max(1.27, ...([As_placed, AsPrime_placed].map(() => 1.27))); // estimación
    // Buscar diámetro real de la barra longitudinal más grande colocada
    let db_long_est = 1.27; // fallback #4
    const asPerBar = As_placed / Math.max(2, Math.ceil(As_placed / 5.07));
    for (const bar of CABILLAS_VE) {
        if (bar.area_cm2 >= asPerBar * 0.8) { db_long_est = bar.diam_cm; break; }
    }

    const s_conf_2001 = Math.min(d / 4, 8 * db_long_est, 24 * db_st, 30);
    const s_conf_2019 = Math.min(d / 4, 6 * db_long_est, 15);
    const s_center = Math.min(d / 2, s_shear);
    const h_conf = 2 * h; // longitud de zona confinada = 2h

    // --- Acero requerido (diseño correcto) ---
    const Mu_design = Math.max(Mu_total_2001, Mu_total_2019); // kgf·m
    const disc = d * d - 2 * Mu_design * 100 / (0.85 * 0.9 * fc * bw);
    let As_req_flex = disc >= 0 ? (0.85 * fc * bw / fy) * (d - Math.sqrt(disc)) : As_min;
    As_req_flex = Math.max(As_req_flex, As_min);

    // Acero requerido para momento negativo (mínimo 50% del positivo por sismo)
    let AsPrime_req = Math.max(0.5 * As_req_flex, As_min);

    // Seleccionar barras comerciales
    const rebarBot = selectRebarCombo(As_req_flex, bw, cover, db_st);
    const rebarTop = selectRebarCombo(AsPrime_req, bw, cover, db_st);
    const rebarBotPlaced = selectRebarCombo(As_placed, bw, cover, db_st);
    const rebarTopPlaced = selectRebarCombo(AsPrime_placed, bw, cover, db_st);

    // Estribos finales (mín entre requerido por cortante y confinamiento)
    const s_final_2001_conf = Math.min(s_conf_2001, s_shear);
    const s_final_2019_conf = Math.min(s_conf_2019, s_shear);

    return {
        // Geometría
        bw, h, d, L_cm, cover, beta1,
        // Cuantías
        rho_b, rho_max, rho_min, rho_placed,
        As_min, As_max, As_placed, AsPrime_placed,
        // Flexión
        a, c, Mn, phiMn, MnPrime, phiMnPrime,
        Mpr_pos, Mpr_neg,
        Mu_sismo_2001, Mu_sismo_2019, Mu_grav,
        Mu_total_2001, Mu_total_2019,
        flexionOK_2001, flexionOK_2019,
        cuantiaOK, ductilityRatio, ductilityOK,
        // Cortante
        Vu_cap, Vc, Vs_req, Vu_design, s_shear, Av,
        // Estribos
        s_conf_2001, s_conf_2019, s_center, h_conf,
        s_final_2001_conf, s_final_2019_conf,
        db_st, db_long_est,
        // Diseño requerido
        As_req_flex, AsPrime_req,
        rebarBot, rebarTop,
        rebarBotPlaced, rebarTopPlaced,
        // Barras para SVG
        nBotBars: rebarBot.n, nTopBars: rebarTop.n
    };
}

// --- GENERACIÓN DE ESPECTROS Y ARCHIVO DE SISMO (MAIN ENGINE) ---
function generateSpectraAndEarthquake() {
    const N = parseInt(document.getElementById("num-stories").value);
    const storyHeight = parseFloat(document.getElementById("story-height").value);

    const autoMass = document.getElementById("auto-mass").checked;
    const storyMass = getCalculatedStoryMass();

    // Actualizar visualización en el sidebar
    const massDisplay = document.getElementById("calculated-mass-display");
    if (massDisplay) {
        massDisplay.textContent = storyMass.toFixed(1);
    }
    const storyMassSliderVal = document.getElementById("story-mass-val");
    if (storyMassSliderVal) {
        storyMassSliderVal.textContent = Math.round(parseFloat(document.getElementById("story-mass").value));
    }

    const analysisMode = document.getElementById("analysis-mode").value;
    const degSeverity = parseFloat(document.getElementById("degradation-severity").value);

    // Período estimado inicial del edificio: T = 0.08 * N (para 4 columnas)
    const targetT1 = 0.08 * N;

    // Leer número de columnas, espaciamiento y calcular período real acoplado
    const numColsX = parseInt(document.getElementById("num-cols-x").value) || 2;
    const numColsY = parseInt(document.getElementById("num-cols-y").value) || 2;
    const numCols = numColsX * numColsY;
    const sX = parseFloat(document.getElementById("col-dist-x").value) || 5.0;
    const sY = parseFloat(document.getElementById("col-dist-y").value) || 5.0;

    // Calcular área tributaria de la losa
    const bW = sX * (numColsX - 1);
    const bD = sY * (numColsY - 1);
    const area = bW * bD;

    // Leer valores de secciones personalizadas
    const customSectionsCheck = document.getElementById("custom-sections-enable");
    const customSections = {
        enable: customSectionsCheck ? customSectionsCheck.checked : false,
        colWidth: parseFloat(document.getElementById("col-width").value) || 35,
        colDepth: parseFloat(document.getElementById("col-depth").value) || 35,
        beamWidth: parseFloat(document.getElementById("beam-width").value) || 30,
        beamDepth: parseFloat(document.getElementById("beam-depth").value) || 45,
        fcCol: parseFloat(document.getElementById("concrete-fc-col").value) || 250,
        fcBeam: parseFloat(document.getElementById("concrete-fc-beam").value) || 250,
        fyCol: parseFloat(document.getElementById("steel-fy-col").value) || 4200,
        fyBeam: parseFloat(document.getElementById("steel-fy-beam").value) || 4200,
        colAs: parseFloat(document.getElementById("col-as").value) || 16,
        beamAs: parseFloat(document.getElementById("beam-as").value) || 12,
        beamAsPrime: parseFloat(document.getElementById("beam-as-prime").value) || 6
    };

    // --- Calcular Parámetros de Diseño Sísmico Tempranamente para el Reporte ---
    const z01 = parseInt(document.getElementById("covenin01-zone").value);
    let Ao01 = 0.30;
    switch (z01) {
        case 7: Ao01 = 0.40; break;
        case 6: Ao01 = 0.35; break;
        case 5: Ao01 = 0.30; break;
        case 4: Ao01 = 0.25; break;
        case 3: Ao01 = 0.20; break;
        case 2: Ao01 = 0.15; break;
        case 1: Ao01 = 0.10; break;
    }
    const soil01 = document.getElementById("covenin01-soil").value;
    const params01 = {
        Ao: Ao01,
        alpha: parseFloat(document.getElementById("covenin01-importance").value),
        phi: getCorrectionFactorPhi2001(z01, soil01),
        R: parseFloat(document.getElementById("covenin01-r").value),
        soil: soil01
    };

    const useVal = document.getElementById("building-use").value;
    const params19 = {
        Ao: parseFloat(document.getElementById("covenin19-a0").value),
        A1: parseFloat(document.getElementById("covenin19-a1").value),
        TL: 4.0,
        alpha: getImportanceFactor2019(useVal),
        R: parseFloat(document.getElementById("covenin19-r").value),
        rho: parseFloat(document.getElementById("covenin19-rho").value),
        Fi: parseFloat(document.getElementById("covenin19-fi").value),
        soilClass: document.getElementById("covenin19-soil-class").value
    };

    // Resumen de Parámetros de Entrada HTML
    let useText = "B2 (General)";
    if (useVal === "critical") useText = "A (Vital / Crítico)";
    else if (useVal === "public" || useVal === "industrial") useText = "B1 (Esencial)";

    let customSectionsHTML = "";
    if (customSections.enable) {
        customSectionsHTML = `
            <tr>
                <td class="calc-param-name">Columnas</td>
                <td class="calc-value">${customSections.colWidth} &times; ${customSections.colDepth} cm</td>
                <td class="calc-unit">f'c: ${customSections.fcCol} | As: ${customSections.colAs} cm²</td>
            </tr>
            <tr>
                <td class="calc-param-name">Vigas</td>
                <td class="calc-value">${customSections.beamWidth} &times; ${customSections.beamDepth} cm</td>
                <td class="calc-unit">f'c: ${customSections.fcBeam} | As,sup: ${customSections.beamAs} | As,inf: ${customSections.beamAsPrime} cm²</td>
            </tr>
        `;
    } else {
        customSectionsHTML = `
            <tr>
                <td class="calc-param-name">Secciones</td>
                <td class="calc-value" style="color: var(--text-muted);">Estándar (Sintonizada)</td>
                <td class="calc-unit">Rigidez por T₁ objetivo</td>
            </tr>
        `;
    }

    const inputParamsHTML = `
        <div style="margin-bottom: 24px; border-bottom: 1px solid var(--border-color); padding-bottom: 20px;">
            <h4 style="color: #ffb703; margin-bottom: 10px; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; text-transform: uppercase; letter-spacing: 0.5px;">
                <i class="fa-solid fa-file-invoice"></i> Parámetros de Entrada de la Estructura
            </h4>
            <div class="grid-columns-report" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; margin-bottom: 12px;">
                <div>
                    <h5 style="color: #fff; margin-bottom: 6px; font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Geometría, Losa y Secciones</h5>
                    <table class="calc-table" style="margin-top: 0;">
                        <tbody>
                            <tr>
                                <td class="calc-param-name" style="width: 35%;">Pisos / Altura</td>
                                <td class="calc-value" style="width: 25%;">${N} Pisos</td>
                                <td class="calc-unit" style="width: 40%;">HP: ${storyHeight.toFixed(2)} m</td>
                            </tr>
                            <tr>
                                <td class="calc-param-name">Distribución</td>
                                <td class="calc-value">${numColsX} &times; ${numColsY} cols</td>
                                <td class="calc-unit">sX: ${sX.toFixed(1)}m | sY: ${sY.toFixed(1)}m</td>
                            </tr>
                            <tr>
                                <td class="calc-param-name">Losa / Uso</td>
                                <td class="calc-value">${(parseFloat(document.getElementById("slab-thickness").value) || 20)} cm</td>
                                <td class="calc-unit">Uso: ${useText}</td>
                            </tr>
                            ${customSectionsHTML}
                        </tbody>
                    </table>
                </div>
                <div>
                    <h5 style="color: #fff; margin-bottom: 6px; font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Parámetros Sísmicos de Entrada</h5>
                    <table class="calc-table" style="margin-top: 0;">
                        <thead>
                            <tr>
                                <th style="width: 35%;">Parámetro</th>
                                <th style="width: 32.5%;">COVENIN 2001</th>
                                <th style="width: 32.5%;">COVENIN 2019</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td class="calc-param-name">Aceleración Base</td>
                                <td class="calc-value">Ao: ${Ao01.toFixed(2)}g (Z${z01})</td>
                                <td class="calc-value">Ao: ${params19.Ao.toFixed(2)}g | A₁: ${params19.A1.toFixed(2)}g</td>
                            </tr>
                            <tr>
                                <td class="calc-param-name">Perfil de Suelo</td>
                                <td class="calc-value">${params01.soil}</td>
                                <td class="calc-value">Clase ${params19.soilClass}</td>
                            </tr>
                            <tr>
                                <td class="calc-param-name">Reducción (R)</td>
                                <td class="calc-value">R = ${params01.R.toFixed(1)}</td>
                                <td class="calc-value">R = ${params19.R.toFixed(1)}</td>
                            </tr>
                            <tr>
                                <td class="calc-param-name">Otros Factores</td>
                                <td class="calc-value">&alpha; = ${params01.alpha.toFixed(1)}</td>
                                <td class="calc-value">&rho; = ${params19.rho.toFixed(1)} | &phi; = ${params19.Fi.toFixed(1)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    let T1_actual_x, T1_actual_y;

    // Generar reporte de cargas si está habilitado el autocálculo de masa
    let loadsReportHTML = '';
    if (autoMass) {
        const breakdown = getDetailedWeightBreakdown();
        loadsReportHTML = `
            <div style="margin-bottom: 24px;">
                <h4 style="color: var(--color-2019); margin-bottom: 10px; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; text-transform: uppercase; letter-spacing: 0.5px;">
                    <i class="fa-solid fa-scale-balanced"></i> Desglose de Masa y Carga Sísmica por Piso
                </h4>
                <table class="calc-table">
                    <thead>
                        <tr>
                            <th>Concepto / Componente</th>
                            <th>Fórmula / Parámetro</th>
                            <th>Carga Unitaria</th>
                            <th>Peso / Carga Total</th>
                            <th>Porcentaje</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td class="calc-param-name">Área Tributaria de Planta</td>
                            <td class="calc-formula">b<sub>W</sub> &times; b<sub>D</sub> = ${breakdown.area.toFixed(1)} m²</td>
                            <td class="calc-value">-</td>
                            <td class="calc-value">${breakdown.area.toFixed(1)} m²</td>
                            <td class="calc-unit">-</td>
                        </tr>
                        <tr>
                            <td class="calc-param-name">Peso Propio de Losa</td>
                            <td class="calc-formula">Area &times; h<sub>losa</sub> &times; 2400 kgf/m³</td>
                            <td class="calc-value">${(breakdown.slabThickness * 100).toFixed(0)} cm (${Math.round(breakdown.slabThickness * 2400)} kgf/m²)</td>
                            <td class="calc-value">${Math.round(breakdown.w_slab).toLocaleString()} kgf</td>
                            <td class="calc-unit">${(breakdown.w_slab / breakdown.w_seismic * 100).toFixed(1)}%</td>
                        </tr>
                        <tr>
                            <td class="calc-param-name">Peso Propio de Vigas</td>
                            <td class="calc-formula">&Sigma; L<sub>vigas</sub> &times; A<sub>viga</sub> &times; 2400 kgf/m³</td>
                            <td class="calc-value">-</td>
                            <td class="calc-value">${Math.round(breakdown.w_beams).toLocaleString()} kgf</td>
                            <td class="calc-unit">${(breakdown.w_beams / breakdown.w_seismic * 100).toFixed(1)}%</td>
                        </tr>
                        <tr>
                            <td class="calc-param-name">Peso Propio de Columnas</td>
                            <td class="calc-formula">N<sub>col</sub> &times; A<sub>col</sub> &times; H<sub>piso</sub> &times; 2400 kgf/m³</td>
                            <td class="calc-value">-</td>
                            <td class="calc-value">${Math.round(breakdown.w_cols).toLocaleString()} kgf</td>
                            <td class="calc-unit">${(breakdown.w_cols / breakdown.w_seismic * 100).toFixed(1)}%</td>
                        </tr>
                        <tr>
                            <td class="calc-param-name">Carga Muerta Adicional</td>
                            <td class="calc-formula">Area &times; Carga<sub>adicional</sub></td>
                            <td class="calc-value">${Math.round(breakdown.extraDL)} kgf/m²</td>
                            <td class="calc-value">${Math.round(breakdown.w_extraDL).toLocaleString()} kgf</td>
                            <td class="calc-unit">${(breakdown.w_extraDL / breakdown.w_seismic * 100).toFixed(1)}%</td>
                        </tr>
                        <tr style="border-top: 1.5px solid rgba(255,255,255,0.15); font-weight: bold;">
                            <td class="calc-param-name" style="color: #fff;">Peso Permanente Total (D)</td>
                            <td class="calc-formula">&Sigma; Cargas Muertas</td>
                            <td class="calc-value" style="color: #fff;">${Math.round(breakdown.deadLoad / breakdown.area)} kgf/m²</td>
                            <td class="calc-value" style="color: #fff;">${Math.round(breakdown.deadLoad).toLocaleString()} kgf</td>
                            <td class="calc-unit" style="color: #fff;">${(breakdown.deadLoad / breakdown.w_seismic * 100).toFixed(1)}%</td>
                        </tr>
                        <tr>
                            <td class="calc-param-name">Carga Variable Total (L)</td>
                            <td class="calc-formula">Area &times; Carga<sub>variable</sub></td>
                            <td class="calc-value">${Math.round(breakdown.liveLoadVal)} kgf/m²</td>
                            <td class="calc-value">${Math.round(breakdown.w_liveLoad).toLocaleString()} kgf</td>
                            <td class="calc-unit">-</td>
                        </tr>
                        <tr>
                            <td class="calc-param-name">Factor de Participación Sísmica</td>
                            <td class="calc-formula">Norma COVENIN 1756</td>
                            <td class="calc-value">&alpha; = ${breakdown.alpha.toFixed(2)}</td>
                            <td class="calc-value" style="color: #ffb703;">${Math.round(breakdown.alpha * breakdown.w_liveLoad).toLocaleString()} kgf (&alpha;&middot;L)</td>
                            <td class="calc-unit">${((breakdown.alpha * breakdown.w_liveLoad) / breakdown.w_seismic * 100).toFixed(1)}%</td>
                        </tr>
                        <tr style="border-top: 2px solid var(--color-2019); font-weight: bold; background: rgba(255, 183, 3, 0.05);">
                            <td class="calc-param-name" style="color: #ffb703;">Peso Sísmico de Diseño (W)</td>
                            <td class="calc-formula" style="color: #ffb703;">D + &alpha; &times; L</td>
                            <td class="calc-value" style="color: #ffb703;">${Math.round(breakdown.w_seismic / breakdown.area)} kgf/m²</td>
                            <td class="calc-value" style="color: #ffb703; font-size: 13px;">${Math.round(breakdown.w_seismic).toLocaleString()} kgf</td>
                            <td class="calc-unit" style="color: #ffb703; font-size: 13px;">${breakdown.mass.toFixed(1)} ton/piso</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        `;
    }

    let reportHTML = inputParamsHTML + loadsReportHTML;

    // Leer direcciones de los sismos
    const sismo1Dir = document.getElementById("sismo1-direction").value;
    const sismo2Dir = document.getElementById("sismo2-direction").value;

    if (customSections.enable) {
        // Calcular T1 usando la inercia agrietada transformada de las vigas
        const CONV = 98066.5; // 1 kgf/cm² = 98066.5 Pa
        const ES_PA = 2.0e6 * CONV; // Módulo del acero en Pa
        const Ec_col_Pa = 15100.0 * Math.sqrt(customSections.fcCol) * CONV;
        const Ec_beam_Pa = 15100.0 * Math.sqrt(customSections.fcBeam) * CONV;

        const bc_x = customSections.colWidth / 100; // m
        const hc_x = customSections.colDepth / 100; // m
        const bc_y = hc_x;
        const hc_y = bc_x;

        const bb = customSections.beamWidth / 100; // m
        const hb = customSections.beamDepth / 100; // m

        // Inercia bruta y transformada de la columna con acero longitudinal - Eje X
        const Ic_gross_x = (bc_x * Math.pow(hc_x, 3)) / 12;
        const n_col_g = ES_PA / Ec_col_Pa;
        const As_col_m2_g = (customSections.colAs) / 1e4;
        const arm_col_g_x = hc_x / 2 - 0.04; // recubrimiento 4 cm
        const Ic_x = Ic_gross_x + (n_col_g - 1) * As_col_m2_g * arm_col_g_x * arm_col_g_x;

        // Inercia bruta y transformada de la columna con acero longitudinal - Eje Y
        const Ic_gross_y = (bc_y * Math.pow(hc_y, 3)) / 12;
        const arm_col_g_y = hc_y / 2 - 0.04;
        const Ic_y = Ic_gross_y + (n_col_g - 1) * As_col_m2_g * arm_col_g_y * arm_col_g_y;

        // Relación modular y áreas de acero en m² para vigas
        const n_mod = ES_PA / Ec_beam_Pa;
        const As_m2 = customSections.beamAs / 1e4;
        const Asp_m2 = customSections.beamAsPrime / 1e4;
        const d_cover = 0.04; // recubrimiento 4 cm
        const d = hb - d_cover;
        const dp = d_cover;

        // Eje neutro agrietado (cuadrática)
        const A_q = bb / 2;
        const B_q = n_mod * (As_m2 + Asp_m2);
        const C_q = -n_mod * (As_m2 * d + Asp_m2 * dp);
        const x_na = (-B_q + Math.sqrt(Math.max(0, B_q * B_q - 4 * A_q * C_q))) / (2 * A_q);

        const Icr = (bb * Math.pow(x_na, 3)) / 3
            + n_mod * Asp_m2 * Math.pow(Math.max(0, x_na - dp), 2)
            + n_mod * As_m2 * Math.pow(Math.max(0, d - x_na), 2);

        // Rigidez de columnas y flexibilidad en X
        const k_col_fixed_x = (12.0 * Ec_col_Pa * Ic_x) / Math.pow(storyHeight, 3);
        const kappa_x = (Ec_beam_Pa * Icr * storyHeight) / (2.0 * Ec_col_Pa * Ic_x * sX);
        const eta_x = (12.0 * kappa_x + 1.0) / (12.0 * kappa_x + 4.0);
        const k_init_custom_x = numCols * k_col_fixed_x * eta_x;

        // Rigidez de columnas y flexibilidad en Y
        const k_col_fixed_y = (12.0 * Ec_col_Pa * Ic_y) / Math.pow(storyHeight, 3);
        const kappa_y = (Ec_beam_Pa * Icr * storyHeight) / (2.0 * Ec_col_Pa * Ic_y * sY);
        const eta_y = (12.0 * kappa_y + 1.0) / (12.0 * kappa_y + 4.0);
        const k_init_custom_y = numCols * k_col_fixed_y * eta_y;

        const m_real = autoMass ? (storyMass * 1000) : ((storyMass * 1000) * (0.3 + 0.7 * (area / 25.0)));
        const sinTerm = Math.sin(Math.PI / (4.0 * N + 2.0));
        T1_actual_x = Math.PI / (Math.sqrt(k_init_custom_x / m_real) * sinTerm);
        T1_actual_y = Math.PI / (Math.sqrt(k_init_custom_y / m_real) * sinTerm);

        // Torsión
        const eccVal = parseFloat(document.getElementById("torsional-eccentricity").value) || 0.0;
        const rp = Math.sqrt((bW * bW + bD * bD) / 12) || 2.0;
        const torsionAmp_x = Math.sqrt(Math.pow(1.0 + (eccVal * bD) / (2.0 * rp), 2) + Math.pow((eccVal * bW) / (2.0 * rp), 2));
        const torsionAmp_y = Math.sqrt(Math.pow(1.0 + (eccVal * bW) / (2.0 * rp), 2) + Math.pow((eccVal * bD) / (2.0 * rp), 2));
        const torsionAmp = Math.sqrt(Math.pow(1.0 + (eccVal * bD) / (2.0 * rp), 2) + Math.pow((eccVal * bW) / (2.0 * rp), 2));

        reportHTML += `
            <div style="margin-bottom: 24px;">
                <h4 style="color: var(--color-2001); margin-bottom: 10px; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; text-transform: uppercase; letter-spacing: 0.5px;">
                    <i class="fa-solid fa-chart-line"></i> Rigideces e Inercias de Secciones Físicas
                </h4>
                <table class="calc-table">
                <thead>
                    <tr>
                        <th>Propiedad Estructural</th>
                        <th>Fórmula / Relación</th>
                        <th>Símbolo</th>
                        <th>Eje X</th>
                        <th>Eje Y</th>
                        <th>Unidad</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td class="calc-param-name">Módulo Elasticidad Concreto (Col.)</td>
                        <td class="calc-formula">15100 &times; &radic;(f'<sub>c,col</sub>)</td>
                        <td class="calc-symbol">E<sub>c,col</sub></td>
                        <td class="calc-value">${Math.round(15100.0 * Math.sqrt(customSections.fcCol)).toLocaleString()}</td>
                        <td class="calc-value">${Math.round(15100.0 * Math.sqrt(customSections.fcCol)).toLocaleString()}</td>
                        <td class="calc-unit">kgf/cm²</td>
                    </tr>
                    <tr>
                        <td class="calc-param-name">Módulo Elasticidad Concreto (Vig.)</td>
                        <td class="calc-formula">15100 &times; &radic;(f'<sub>c,vig</sub>)</td>
                        <td class="calc-symbol">E<sub>c,vig</sub></td>
                        <td class="calc-value">${Math.round(15100.0 * Math.sqrt(customSections.fcBeam)).toLocaleString()}</td>
                        <td class="calc-value">${Math.round(15100.0 * Math.sqrt(customSections.fcBeam)).toLocaleString()}</td>
                        <td class="calc-unit">kgf/cm²</td>
                    </tr>
                    <tr>
                        <td class="calc-param-name">Relación Modular Concreto-Acero</td>
                        <td class="calc-formula">E<sub>s</sub> / E<sub>c,vig</sub></td>
                        <td class="calc-symbol">n</td>
                        <td class="calc-value">${n_mod.toFixed(2)}</td>
                        <td class="calc-value">${n_mod.toFixed(2)}</td>
                        <td class="calc-unit">-</td>
                    </tr>
                    <tr>
                        <td class="calc-param-name">Inercia Bruta de Columna (sola)</td>
                        <td class="calc-formula">b<sub>c</sub> &times; h<sub>c</sub><sup>3</sup> / 12</td>
                        <td class="calc-symbol">I<sub>g,col</sub></td>
                        <td class="calc-value">${(Ic_gross_x * 1e4).toFixed(3)}</td>
                        <td class="calc-value">${(Ic_gross_y * 1e4).toFixed(3)}</td>
                        <td class="calc-unit">10<sup>-4</sup> m⁴</td>
                    </tr>
                    <tr>
                        <td class="calc-param-name">Inercia Transformada Columna (c/acero)</td>
                        <td class="calc-formula">I<sub>g</sub> + (n-1) &times; A<sub>s</sub> &times; d'<sup>2</sup></td>
                        <td class="calc-symbol">I<sub>c,eff</sub></td>
                        <td class="calc-value">${(Ic_x * 1e4).toFixed(3)}</td>
                        <td class="calc-value">${(Ic_y * 1e4).toFixed(3)}</td>
                        <td class="calc-unit">10<sup>-4</sup> m⁴</td>
                    </tr>
                    <tr>
                        <td class="calc-param-name">Eje Neutro Agrietado de Viga</td>
                        <td class="calc-formula">Ecuación cuadrática x<sub>na</sub></td>
                        <td class="calc-symbol">x<sub>na</sub></td>
                        <td class="calc-value">${(x_na * 100).toFixed(2)}</td>
                        <td class="calc-value">${(x_na * 100).toFixed(2)}</td>
                        <td class="calc-unit">cm</td>
                    </tr>
                    <tr>
                        <td class="calc-param-name">Inercia Agrietada Transf. de Viga</td>
                        <td class="calc-formula">b &times; x<sup>3</sup>/3 + n &times; A<sub>sp</sub> &times; (x-d')<sup>2</sup> + n &times; A<sub>s</sub> &times; (d-x)<sup>2</sup></td>
                        <td class="calc-symbol">I<sub>cr</sub></td>
                        <td class="calc-value">${(Icr * 1e4).toFixed(3)}</td>
                        <td class="calc-value">${(Icr * 1e4).toFixed(3)}</td>
                        <td class="calc-unit">10<sup>-4</sup> m⁴</td>
                    </tr>
                    <tr>
                        <td class="calc-param-name">Rigidez de Columna Empotrada</td>
                        <td class="calc-formula">12 &times; E<sub>c,col</sub> &times; I<sub>c,eff</sub> / H<sup>3</sup></td>
                        <td class="calc-symbol">k<sub>col</sub></td>
                        <td class="calc-value">${Math.round(k_col_fixed_x / 9.80665).toLocaleString()}</td>
                        <td class="calc-value">${Math.round(k_col_fixed_y / 9.80665).toLocaleString()}</td>
                        <td class="calc-unit">kgf/m</td>
                    </tr>
                    <tr>
                        <td class="calc-param-name">Factor Rigidez Viga-Columna</td>
                        <td class="calc-formula">(E<sub>v</sub> &times; I<sub>cr</sub> &times; H) / (2 &times; E<sub>c</sub> &times; I<sub>c,eff</sub> &times; L)</td>
                        <td class="calc-symbol">&kappa;</td>
                        <td class="calc-value">${kappa_x.toFixed(3)}</td>
                        <td class="calc-value">${kappa_y.toFixed(3)}</td>
                        <td class="calc-unit">-</td>
                    </tr>
                    <tr>
                        <td class="calc-param-name">Reducción por Flexibilidad de Vigas</td>
                        <td class="calc-formula">(12&kappa; + 1) / (12&kappa; + 4)</td>
                        <td class="calc-symbol">&eta;</td>
                        <td class="calc-value">${eta_x.toFixed(3)}</td>
                        <td class="calc-value">${eta_y.toFixed(3)}</td>
                        <td class="calc-unit">-</td>
                    </tr>
                    <tr>
                        <td class="calc-param-name">Masa Tributaria por Piso</td>
                        <td class="calc-formula">m<sub>base</sub> &times; (0.3 + 0.7 &times; Área / 25)</td>
                        <td class="calc-symbol">m</td>
                        <td class="calc-value">${(m_real / 1000).toFixed(1)}</td>
                        <td class="calc-value">${(m_real / 1000).toFixed(1)}</td>
                        <td class="calc-unit">ton</td>
                    </tr>
                    <tr>
                        <td class="calc-param-name">Rigidez Lateral Total de Entrepiso</td>
                        <td class="calc-formula">N<sub>col</sub> &times; k<sub>col</sub> &times; &eta;</td>
                        <td class="calc-symbol">k<sub>init</sub></td>
                        <td class="calc-value">${Math.round(k_init_custom_x / 9.80665).toLocaleString()}</td>
                        <td class="calc-value">${Math.round(k_init_custom_y / 9.80665).toLocaleString()}</td>
                        <td class="calc-unit">kgf/m</td>
                    </tr>
                    <tr>
                        <td class="calc-param-name">Período Fundamental Calculado</td>
                        <td class="calc-formula">&pi; / ( &radic;(k/m) &times; sen(&pi;/(4N+2)) )</td>
                        <td class="calc-symbol">T<sub>1</sub></td>
                        <td class="calc-value" style="color: #00b4d8; font-weight: bold;">${T1_actual_x.toFixed(3)}</td>
                        <td class="calc-value" style="color: #ff007f; font-weight: bold;">${T1_actual_y.toFixed(3)}</td>
                        <td class="calc-unit">s</td>
                    </tr>
                    <tr>
                        <td class="calc-param-name">Factor Amplificación Torsional</td>
                        <td class="calc-formula">&radic;( (1 + e&middot;b<sub>D</sub>/(2r<sub>p</sub>))<sup>2</sup> + (e&middot;b<sub>W</sub>/(2r<sub>p</sub>))<sup>2</sup> )</td>
                        <td class="calc-symbol">f<sub>torsion</sub></td>
                        <td class="calc-value" style="color: #ffb703;">${torsionAmp_x.toFixed(3)}</td>
                        <td class="calc-value" style="color: #ffb703;">${torsionAmp_y.toFixed(3)}</td>
                        <td class="calc-unit">-</td>
                    </tr>
                </tbody>
            </table>
            </div>
        `;
    } else {
        // Ratios de masa y rigidez para calcular T1_actual estándar
        const massRatio = 0.3 + 0.7 * (area / 25.0);
        const phi_Sx = (60.0 + sX) / (60.0 + 4.0 * sX);
        const phi_Sy = (60.0 + sY) / (60.0 + 4.0 * sY);
        const phi_ref = 0.8125;
        const stiffnessRatio_x = (numCols / 4.0) * (phi_Sx / phi_ref);
        const stiffnessRatio_y = (numCols / 4.0) * (phi_Sy / phi_ref);
        T1_actual_x = targetT1 * Math.sqrt(massRatio / stiffnessRatio_x);
        T1_actual_y = targetT1 * Math.sqrt(massRatio / stiffnessRatio_y);

        const m_real = autoMass ? (storyMass * 1000) : ((storyMass * 1000) * massRatio);
        const sinTerm = Math.sin(Math.PI / (4.0 * N + 2.0));
        const k_ref = (storyMass * 1000) * Math.pow(Math.PI / (targetT1 * sinTerm), 2);
        const k_init_std_x = k_ref * (numCols / 4.0) * (phi_Sx / phi_ref);
        const k_init_std_y = k_ref * (numCols / 4.0) * (phi_Sy / phi_ref);

        // Torsión
        const eccVal = parseFloat(document.getElementById("torsional-eccentricity").value) || 0.0;
        const rp = Math.sqrt((bW * bW + bD * bD) / 12) || 2.0;
        const torsionAmp_x = Math.sqrt(Math.pow(1.0 + (eccVal * bD) / (2.0 * rp), 2) + Math.pow((eccVal * bW) / (2.0 * rp), 2));
        const torsionAmp_y = Math.sqrt(Math.pow(1.0 + (eccVal * bW) / (2.0 * rp), 2) + Math.pow((eccVal * bD) / (2.0 * rp), 2));

        reportHTML += `
            <div class="calc-sections-disabled-msg">
                <p><strong>Modo Estándar (Sintonizado) Activo.</strong></p>
                <p style="margin-top: 6px; font-size: 12px; color: var(--text-muted);">La rigidez lateral de los entrepisos está calibrada para coincidir con el período fundamental objetivo. Valores calculados básicos:</p>
                <table class="calc-table" style="margin-top: 12px;">
                    <thead>
                        <tr>
                            <th>Propiedad</th>
                            <th>Símbolo</th>
                            <th>Eje X</th>
                            <th>Eje Y</th>
                            <th>Unidad</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td class="calc-param-name">Masa por Piso</td>
                            <td class="calc-symbol">m</td>
                            <td class="calc-value">${(m_real / 1000).toFixed(1)}</td>
                            <td class="calc-value">${(m_real / 1000).toFixed(1)}</td>
                            <td class="calc-unit">ton</td>
                        </tr>
                        <tr>
                            <td class="calc-param-name">Rigidez Calibrada de Entrepiso</td>
                            <td class="calc-symbol">k<sub>init</sub></td>
                            <td class="calc-value">${Math.round(k_init_std_x / 9.80665).toLocaleString()}</td>
                            <td class="calc-value">${Math.round(k_init_std_y / 9.80665).toLocaleString()}</td>
                            <td class="calc-unit">kgf/m</td>
                        </tr>
                        <tr>
                            <td class="calc-param-name">Período Fundamental Estimado</td>
                            <td class="calc-symbol">T<sub>1</sub></td>
                            <td class="calc-value" style="color: #00b4d8; font-weight: bold;">${T1_actual_x.toFixed(3)}</td>
                            <td class="calc-value" style="color: #ff007f; font-weight: bold;">${T1_actual_y.toFixed(3)}</td>
                            <td class="calc-unit">s</td>
                        </tr>
                        <tr>
                            <td class="calc-param-name">Factor Amplificación Torsional</td>
                            <td class="calc-symbol">f<sub>torsion</sub></td>
                            <td class="calc-value" style="color: #ffb703;">${torsionAmp_x.toFixed(3)}</td>
                            <td class="calc-value" style="color: #ffb703;">${torsionAmp_y.toFixed(3)}</td>
                            <td class="calc-unit">-</td>
                        </tr>
                    </tbody>
                </table>
                <p style="margin-top: 12px; font-size: 11.5px; color: var(--color-2001);">Habilita la casilla <strong>"Habilitar Secciones Físicas"</strong> en el panel de control lateral para ver el desglose completo del cálculo de inercias transformadas y agrietadas.</p>
            </div>
        `;
    }

    // Obtener ordenada de diseño para el edificio 2001 en su periodo fundamental real de la dirección del sismo 1
    const T1_design_2001 = (sismo1Dir === 'X') ? T1_actual_x : T1_actual_y;
    const designAd2001 = getSpectrum2001(T1_design_2001, params01);

    // Obtener ordenada de diseño para el edificio 2019 en su periodo fundamental real de la dirección del sismo 2
    const T1_design_2019 = (sismo2Dir === 'X') ? T1_actual_x : T1_actual_y;
    const designAd2019 = getSpectrum2019(T1_design_2019, params19);

    // Calcular ordenadas de diseño específicas para X e Y para instanciación
    const designAd2001_x = getSpectrum2001(T1_actual_x, params01);
    const designAd2001_y = getSpectrum2001(T1_actual_y, params01);
    const designAd2019_x = getSpectrum2019(T1_actual_x, params19);
    const designAd2019_y = getSpectrum2019(T1_actual_y, params19);

    // --- 3. Instanciar los Modelos de Edificios con espaciamiento y secciones ---
    eq2001 = new BuildingModel(N, storyHeight, storyMass, targetT1, designAd2001_x, designAd2001_y, analysisMode, degSeverity, numColsX, numColsY, sX, sY, customSections, 2001);
    eq2019 = new BuildingModel(N, storyHeight, storyMass, targetT1, designAd2019_x, designAd2019_y, analysisMode, degSeverity, numColsX, numColsY, sX, sY, customSections, 2019);

    // --- 4. Generar la Serie de Tiempo del Sismo Sucesivo ---
    // Determinamos el período del suelo para sintonizar la frecuencia del sismo
    // COVENIN 2001 suelo determina T*
    // S1: 0.4s, S2: 0.7s, S3: 1.0s, S4: 1.3s
    let T_soil = 0.7;
    switch (params01.soil) {
        case 'S1': T_soil = 0.4; break;
        case 'S2': T_soil = 0.7; break;
        case 'S3': T_soil = 1.0; break;
        case 'S4': T_soil = 1.3; break;
    }

    // PGAs configurables por el usuario: Sismo 1 (ej. 0.40g) y Sismo 2 (ej. 0.60g)
    const pga1 = parseFloat(document.getElementById("sismo1-pga")?.value) || 0.40;
    const pga2 = parseFloat(document.getElementById("sismo2-pga")?.value) || 0.60;
    const hasSecond = document.getElementById("double-earthquake").checked;

    generateSyntheticEarthquake(T_soil, pga1, pga2, hasSecond);

    // Llenar el vector de tiempos
    timeSeries = [];
    for (let i = 0; i < groundAccel.length; i++) {
        timeSeries.push((i * dt).toFixed(2));
    }

    // --- 5. Dibujar los Espectros en el Tab de Gráficos ---
    drawSpectraChart(params01, params19, T1_actual_x, T1_actual_y);

    // --- Verificación SCWB en Reporte ---
    if (customSections.enable) {
        const check2001 = eq2001.strongColumnWeakBeam
            ? `<span style="color: var(--color-safe); font-weight: bold;"><i class="fa-solid fa-circle-check"></i> Cumple (Viga Débil)</span>`
            : `<span style="color: var(--color-damage); font-weight: bold;"><i class="fa-solid fa-triangle-exclamation"></i> Columna Débil (⚠️ Rótulas en Columnas)</span>`;
        const check2019 = eq2019.strongColumnWeakBeam
            ? `<span style="color: var(--color-safe); font-weight: bold;"><i class="fa-solid fa-circle-check"></i> Cumple (Viga Débil)</span>`
            : `<span style="color: var(--color-damage); font-weight: bold;"><i class="fa-solid fa-triangle-exclamation"></i> Columna Débil (⚠️ Rótulas en Columnas)</span>`;

        // --- Verificación de Cuantías y Acero Mínimo (COVENIN 1753) ---
        const Ag_col = customSections.colWidth * customSections.colDepth; // cm²
        const As_col_placed = customSections.colAs; // cm²
        const rho_col_placed = As_col_placed / Ag_col; // ratio
        const colSteelRatioPercent = (rho_col_placed * 100).toFixed(2) + "%";
        const colAsMin = 0.01 * Ag_col; // cm²
        const colCompliance = (As_col_placed >= colAsMin)
            ? `<span style="color: var(--color-safe); font-weight: bold;"><i class="fa-solid fa-circle-check"></i> Cumple (&rho; &ge; 1.0%)</span>`
            : `<span style="color: var(--color-damage); font-weight: bold;"><i class="fa-solid fa-triangle-exclamation"></i> No Cumple (Cuantía < 1.0% | Mín: ${colAsMin.toFixed(1)} cm²)</span>`;

        const bw_beam = customSections.beamWidth; // cm
        const hb_beam = customSections.beamDepth; // cm
        const d_beam = hb_beam - 4.0; // cm
        const fc_beam_val = customSections.fcBeam;
        const fy_beam_val = customSections.fyBeam;
        const rho_min_beam = Math.max((0.8 * Math.sqrt(fc_beam_val)) / fy_beam_val, 14.0 / fy_beam_val);
        const beamAsMin = rho_min_beam * bw_beam * d_beam; // cm²
        const As_beam_placed = customSections.beamAs; // cm²
        const beamCompliance = (As_beam_placed >= beamAsMin)
            ? `<span style="color: var(--color-safe); font-weight: bold;"><i class="fa-solid fa-circle-check"></i> Cumple (Mín: ${beamAsMin.toFixed(2)} cm²)</span>`
            : `<span style="color: var(--color-damage); font-weight: bold;"><i class="fa-solid fa-triangle-exclamation"></i> No Cumple (Mín: ${beamAsMin.toFixed(2)} cm²)</span>`;

        const AsPrime_beam_placed = customSections.beamAsPrime; // cm²
        const beamSeismicCompliance = (AsPrime_beam_placed >= 0.5 * As_beam_placed)
            ? `<span style="color: var(--color-safe); font-weight: bold;"><i class="fa-solid fa-circle-check"></i> Cumple (A'<sub>s</sub> &ge; 0.5A<sub>s</sub>)</span>`
            : `<span style="color: var(--color-damage); font-weight: bold;"><i class="fa-solid fa-triangle-exclamation"></i> No Cumple (A'<sub>s</sub> < 0.5A<sub>s</sub> | Mín: ${(0.5 * As_beam_placed).toFixed(1)} cm²)</span>`;

        reportHTML += `
            <div style="margin-top: 24px; margin-bottom: 24px; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 20px;">
                <h4 style="color: #ffb703; margin-bottom: 10px; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; text-transform: uppercase; letter-spacing: 0.5px;">
                    <i class="fa-solid fa-shield-halved"></i> Verificación Columna Fuerte - Viga Débil (SCWB)
                </h4>
                <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px; line-height: 1.5;">
                    De acuerdo con los principios de diseño sismorresistente, la suma de los momentos nominales de las columnas en un nudo debe superar en al menos un 20% a la de las vigas (<strong>&Sigma;M<sub>n,col</sub> &ge; 1.2 &Sigma;M<sub>n,vig</sub></strong>) para inducir un mecanismo de falla dúctil y evitar el colapso por piso blando.
                </p>
                <table class="calc-table">
                    <thead>
                        <tr>
                            <th>Parámetro de Diseño</th>
                            <th>Fórmula / Método</th>
                            <th>Símbolo</th>
                            <th>COVENIN 2001</th>
                            <th>COVENIN 2019</th>
                            <th>Unidad</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td class="calc-param-name">Momento Nominal de Viga</td>
                            <td class="calc-formula">A<sub>s</sub> &times; f<sub>y</sub> &times; (d - a/2)</td>
                            <td class="calc-symbol">M<sub>n,vig</sub></td>
                            <td class="calc-value">${eq2001.Mn_beam.toFixed(1)}</td>
                            <td class="calc-value">${eq2019.Mn_beam.toFixed(1)}</td>
                            <td class="calc-unit">kgf&middot;m</td>
                        </tr>
                        <tr>
                            <td class="calc-param-name">Momento Nominal de Columna</td>
                            <td class="calc-formula">Aproximación con P<sub>u</sub> promedio</td>
                            <td class="calc-symbol">M<sub>n,col</sub></td>
                            <td class="calc-value">${eq2001.Mn_col.toFixed(1)}</td>
                            <td class="calc-value">${eq2019.Mn_col.toFixed(1)}</td>
                            <td class="calc-unit">kgf&middot;m</td>
                        </tr>
                        <tr>
                            <td class="calc-param-name">Relación de Momentos en Nudo</td>
                            <td class="calc-formula">&Sigma;M<sub>n,col</sub> / &Sigma;M<sub>n,vig</sub></td>
                            <td class="calc-symbol">Ratio (min 1.20)</td>
                            <td class="calc-value" style="font-weight: bold; color: ${eq2001.strongColumnWeakBeam ? 'var(--color-safe)' : 'var(--color-damage)'};">${eq2001.scwbRatio.toFixed(2)}</td>
                            <td class="calc-value" style="font-weight: bold; color: ${eq2019.strongColumnWeakBeam ? 'var(--color-safe)' : 'var(--color-damage)'};">${eq2019.scwbRatio.toFixed(2)}</td>
                            <td class="calc-unit">-</td>
                        </tr>
                        <tr>
                            <td class="calc-param-name">Estado de Verificación</td>
                            <td class="calc-formula">&Sigma;M<sub>n,col</sub> &ge; 1.2 &Sigma;M<sub>n,vig</sub></td>
                            <td class="calc-symbol">SCWB</td>
                            <td class="calc-value">${check2001}</td>
                            <td class="calc-value">${check2019}</td>
                            <td class="calc-unit">-</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div style="margin-top: 24px; margin-bottom: 24px; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 20px;">
                <h4 style="color: var(--color-2019); margin-bottom: 10px; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; text-transform: uppercase; letter-spacing: 0.5px;">
                    <i class="fa-solid fa-shield-cat"></i> Verificación de Cuantías y Acero Mínimo (COVENIN 1753)
                </h4>
                <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px; line-height: 1.5;">
                    Verificación de límites normativos de refuerzo longitudinal para elementos de pórticos especiales resistentes a sismos (Nivel de Diseño ND3 / Ductilidad Alta).
                </p>
                <table class="calc-table">
                    <thead>
                        <tr>
                            <th>Miembro Estructural</th>
                            <th>Límite Normativo COVENIN 1753</th>
                            <th>Fórmula de Control</th>
                            <th>Acero Requerido</th>
                            <th>Acero Colocado</th>
                            <th>Estado</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td class="calc-param-name"><strong>Columnas</strong> (Acero Total)</td>
                            <td class="calc-formula">Cuantía geométrica mínima del 1.0%</td>
                            <td class="calc-symbol">A<sub>st,mín</sub> = 0.01 &times; A<sub>g</sub></td>
                            <td class="calc-value">${colAsMin.toFixed(1)} cm²</td>
                            <td class="calc-value" style="font-weight: bold; color: ${As_col_placed >= colAsMin ? 'var(--color-safe)' : 'var(--color-damage)'};">${As_col_placed.toFixed(1)} cm² (${colSteelRatioPercent})</td>
                            <td class="calc-value">${colCompliance}</td>
                        </tr>
                        <tr>
                            <td class="calc-param-name"><strong>Vigas apoyos</strong> (Cara Tracción)</td>
                            <td class="calc-formula">Acero mínimo por flexión en vigas</td>
                            <td class="calc-symbol">A<sub>s,mín</sub> = max(0.8&radic;f'c/fy, 14/fy)bd</td>
                            <td class="calc-value">${beamAsMin.toFixed(2)} cm²</td>
                            <td class="calc-value" style="font-weight: bold; color: ${As_beam_placed >= beamAsMin ? 'var(--color-safe)' : 'var(--color-damage)'};">${As_beam_placed.toFixed(2)} cm²</td>
                            <td class="calc-value">${beamCompliance}</td>
                        </tr>
                        <tr>
                            <td class="calc-param-name"><strong>Vigas apoyos</strong> (Cara Compresión)</td>
                            <td class="calc-formula">Doble armadura por sismo invertido (ND3)</td>
                            <td class="calc-symbol">A'<sub>s</sub> &ge; 0.5 &times; A<sub>s</sub></td>
                            <td class="calc-value">${(0.5 * As_beam_placed).toFixed(2)} cm²</td>
                            <td class="calc-value" style="font-weight: bold; color: ${AsPrime_beam_placed >= 0.5 * As_beam_placed ? 'var(--color-safe)' : 'var(--color-damage)'};">${AsPrime_beam_placed.toFixed(2)} cm²</td>
                            <td class="calc-value">${beamSeismicCompliance}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        `;

        // --- VERIFICACIÓN Y DISEÑO DE VIGAS POR TEORÍA DE ROTURA ---
        const nBaysX = numColsX - 1;
        const nBaysY = numColsY - 1;
        const L_x_cm = sX * 100; // luz libre en X (cm)
        const L_y_cm = sY * 100; // luz libre en Y (cm)
        const h_story_cm = storyHeight * 100;

        // Cortante basal de primer piso en Newtons (N), convertir a kgf dividiendo por G (9.81)
        const Vb_x_2001_kgf = (eq2001.V_design_x ? eq2001.V_design_x[0] : 0) / G;
        const Vb_x_2019_kgf = (eq2019.V_design_x ? eq2019.V_design_x[0] : 0) / G;

        const Vb_y_2001_kgf = (eq2001.V_design_y ? eq2001.V_design_y[0] : 0) / G;
        const Vb_y_2019_kgf = (eq2019.V_design_y ? eq2019.V_design_y[0] : 0) / G;

        // Calcular diseño para dirección X
        const beamX = computeBeamDesign(
            customSections.beamWidth, customSections.beamDepth,
            customSections.fcBeam, customSections.fyBeam,
            customSections.beamAs, customSections.beamAsPrime,
            L_x_cm, Vb_x_2001_kgf, Vb_x_2019_kgf, h_story_cm, nBaysX,
            numColsY, sY,
            `VIGA DIRECCIÓN X (Luz: ${sX.toFixed(2)} m)`
        );

        // Si las luces son distintas, calcular también Y
        const twoDirections = Math.abs(sX - sY) > 0.01;
        let beamY = null;
        if (twoDirections) {
            beamY = computeBeamDesign(
                customSections.beamWidth, customSections.beamDepth,
                customSections.fcBeam, customSections.fyBeam,
                customSections.beamAs, customSections.beamAsPrime,
                L_y_cm, Vb_y_2001_kgf, Vb_y_2019_kgf, h_story_cm, nBaysY,
                numColsX, sX,
                `VIGA DIRECCIÓN Y (Luz: ${sY.toFixed(2)} m)`
            );
        }

        // Guardar datos globalmente para la visualización 3D post-simulación
        lastBeamDesignX = beamX;
        lastBeamDesignY = beamY;
        lastStructuralConfig = { nBaysX, nBaysY, numColsX, numColsY, sX, sY, storyHeight, h_story_cm };

        // --- Generar HTML para cada dirección ---
        function beamDesignHTML(bd, dirName) {
            const statusIcon = (ok) => ok
                ? `<span style="color: var(--color-safe); font-weight: bold;"><i class="fa-solid fa-circle-check"></i> Cumple</span>`
                : `<span style="color: var(--color-damage); font-weight: bold;"><i class="fa-solid fa-triangle-exclamation"></i> No Cumple</span>`;

            const svgDrawing = generateBeamSVG(
                bd.bw, bd.h, bd.d, bd.L_cm, bd.cover,
                bd.nBotBars, bd.nTopBars,
                bd.s_conf_2019, bd.s_center, bd.h_conf, bd.db_st,
                dirName
            );

            return `
                <div style="margin-top: 16px; padding: 16px; background: rgba(0,0,0,0.15); border-radius: 10px; border: 1px solid rgba(255,255,255,0.06);">
                    <h5 style="color: #00f2fe; margin-bottom: 10px; font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 6px;">
                        <i class="fa-solid fa-arrows-left-right"></i> ${dirName}
                    </h5>

                    <!-- Tabla de Verificación por Teoría de Rotura (Flexión) -->
                    <p style="font-size: 11px; color: var(--text-muted); margin-bottom: 8px; line-height: 1.5;">
                        <strong>Verificación a Flexión por Teoría de Rotura</strong> — Capacidad nominal (φM<sub>n</sub>) vs demandas por norma.
                    </p>
                    <table class="calc-table" style="margin-bottom: 16px;">
                        <thead>
                            <tr>
                                <th>Parámetro de Control</th>
                                <th>Fórmula / Método</th>
                                <th>COVENIN 2001</th>
                                <th>COVENIN 2019</th>
                                <th>Unidad</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td class="calc-param-name">Momento Nominal (M<sub>n</sub>)</td>
                                <td class="calc-formula">A<sub>s</sub>×f<sub>y</sub>×(d - a/2)</td>
                                <td class="calc-value" colspan="2" style="font-weight:bold; text-align:center;">${bd.Mn.toFixed(0)}</td>
                                <td class="calc-unit">kgf·m</td>
                            </tr>
                            <tr>
                                <td class="calc-param-name">Capacidad Reducida (φM<sub>n</sub>)</td>
                                <td class="calc-formula">φ = 0.90 × M<sub>n</sub></td>
                                <td class="calc-value" colspan="2" style="font-weight:bold; color: #00f2fe; text-align:center;">${bd.phiMn.toFixed(0)}</td>
                                <td class="calc-unit">kgf·m</td>
                            </tr>
                            <tr>
                                <td class="calc-param-name">Momento por Sismo (M<sub>sismo</sub>)</td>
                                <td class="calc-formula">V<sub>pórtico</sub> × h / (4 × N<sub>vanos</sub>)</td>
                                <td class="calc-value">${bd.Mu_sismo_2001.toFixed(0)}</td>
                                <td class="calc-value">${bd.Mu_sismo_2019.toFixed(0)}</td>
                                <td class="calc-unit">kgf·m</td>
                            </tr>
                            <tr>
                                <td class="calc-param-name">Momento por Gravedad (M<sub>grav</sub>)</td>
                                <td class="calc-formula">w<sub>u</sub> × L² / 12 (1.2D + 1.0L)</td>
                                <td class="calc-value" colspan="2" style="text-align:center;">${bd.Mu_grav.toFixed(0)}</td>
                                <td class="calc-unit">kgf·m</td>
                            </tr>
                            <tr>
                                <td class="calc-param-name">Momento Último (M<sub>u</sub>)</td>
                                <td class="calc-formula">M<sub>sismo</sub> + M<sub>grav</sub></td>
                                <td class="calc-value" style="font-weight:bold;">${bd.Mu_total_2001.toFixed(0)}</td>
                                <td class="calc-value" style="font-weight:bold;">${bd.Mu_total_2019.toFixed(0)}</td>
                                <td class="calc-unit">kgf·m</td>
                            </tr>
                            <tr style="background: rgba(255,255,255,0.03);">
                                <td class="calc-param-name" style="font-weight:bold;">Estado de Verificación</td>
                                <td class="calc-formula">φM<sub>n</sub> ≥ M<sub>u</sub></td>
                                <td class="calc-value">${statusIcon(bd.flexionOK_2001)}</td>
                                <td class="calc-value">${statusIcon(bd.flexionOK_2019)}</td>
                                <td class="calc-unit">-</td>
                            </tr>
                        </tbody>
                    </table>

                    <!-- Tabla de Cortante y Estribos -->
                    <p style="font-size: 11px; color: var(--text-muted); margin-bottom: 8px; line-height: 1.5;">
                        <strong>Verificación a Cortante y Diseño de Estribos</strong> — Diseño por capacidad con momentos probables (1.25f<sub>y</sub>).
                    </p>
                    <table class="calc-table" style="margin-bottom: 16px;">
                        <thead>
                            <tr>
                                <th>Parámetro</th>
                                <th>Fórmula / Método</th>
                                <th>Valor</th>
                                <th>Unidad</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td class="calc-param-name">M<sub>pr</sub> positivo</td>
                                <td class="calc-formula">A<sub>s</sub> × 1.25f<sub>y</sub> × (d - a<sub>pr</sub>/2)</td>
                                <td class="calc-value">${bd.Mpr_pos.toFixed(0)}</td>
                                <td class="calc-unit">kgf·m</td>
                            </tr>
                            <tr>
                                <td class="calc-param-name">M<sub>pr</sub> negativo</td>
                                <td class="calc-formula">A'<sub>s</sub> × 1.25f<sub>y</sub> × (d - a'<sub>pr</sub>/2)</td>
                                <td class="calc-value">${bd.Mpr_neg.toFixed(0)}</td>
                                <td class="calc-unit">kgf·m</td>
                            </tr>
                            <tr>
                                <td class="calc-param-name">V<sub>u</sub> (capacidad)</td>
                                <td class="calc-formula">(M<sub>pr+</sub> + M<sub>pr-</sub>)/L<sub>n</sub> + 1.2w<sub>u</sub>L<sub>n</sub>/2</td>
                                <td class="calc-value" style="font-weight:bold;">${bd.Vu_design.toFixed(0)}</td>
                                <td class="calc-unit">kgf</td>
                            </tr>
                            <tr>
                                <td class="calc-param-name">V<sub>c</sub> (aporte concreto)</td>
                                <td class="calc-formula">0.53×√f'c×b×d</td>
                                <td class="calc-value">${bd.Vc.toFixed(0)}</td>
                                <td class="calc-unit">kgf</td>
                            </tr>
                            <tr>
                                <td class="calc-param-name">V<sub>s</sub> requerido</td>
                                <td class="calc-formula">V<sub>u</sub>/φ - V<sub>c</sub> (φ=0.85)</td>
                                <td class="calc-value">${bd.Vs_req.toFixed(0)}</td>
                                <td class="calc-unit">kgf</td>
                            </tr>
                            <tr>
                                <td class="calc-param-name">Sep. por cortante</td>
                                <td class="calc-formula">A<sub>v</sub>×f<sub>y</sub>×d / V<sub>s</sub> (A<sub>v</sub> = ${bd.Av.toFixed(2)} cm²)</td>
                                <td class="calc-value">${bd.s_shear > 900 ? '∞ (V<sub>c</sub> suficiente)' : bd.s_shear.toFixed(1) + ' cm'}</td>
                                <td class="calc-unit">cm</td>
                            </tr>
                        </tbody>
                    </table>

                    <!-- Tabla de Confinamiento -->
                    <p style="font-size: 11px; color: var(--text-muted); margin-bottom: 8px; line-height: 1.5;">
                        <strong>Separación de Estribos en Zonas de Confinamiento</strong> — Primer estribo a 5 cm de la cara de la columna.
                    </p>
                    <table class="calc-table" style="margin-bottom: 16px;">
                        <thead>
                            <tr>
                                <th>Zona</th>
                                <th>COVENIN 2001</th>
                                <th>COVENIN 2019</th>
                                <th>Longitud</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td class="calc-param-name"><strong>Zona Confinada</strong> (extremos)</td>
                                <td class="calc-value">s ≤ min(d/4, 8d<sub>b</sub>, 24d<sub>est</sub>, 30cm) = <strong>${bd.s_final_2001_conf.toFixed(1)} cm</strong></td>
                                <td class="calc-value">s ≤ min(d/4, 6d<sub>b</sub>, 15cm) = <strong>${bd.s_final_2019_conf.toFixed(1)} cm</strong></td>
                                <td class="calc-value">2h = ${(bd.h_conf / 100).toFixed(2)} m</td>
                            </tr>
                            <tr>
                                <td class="calc-param-name"><strong>Zona Central</strong></td>
                                <td class="calc-value" colspan="2">s ≤ d/2 = <strong>${bd.s_center.toFixed(1)} cm</strong></td>
                                <td class="calc-value">Resto del claro</td>
                            </tr>
                        </tbody>
                    </table>

                    <!-- Tabla de Acero Requerido vs Colocado -->
                    <p style="font-size: 11px; color: var(--text-muted); margin-bottom: 8px; line-height: 1.5;">
                        <strong>Acero Requerido vs Colocado</strong> — Diseño correcto según normas COVENIN.
                    </p>
                    <table class="calc-table" style="margin-bottom: 16px;">
                        <thead>
                            <tr>
                                <th>Cara</th>
                                <th>A<sub>s</sub> Requerido</th>
                                <th>Barras Sugeridas (Diseño)</th>
                                <th>A<sub>s</sub> Colocado</th>
                                <th>Barras Colocadas</th>
                                <th>Estado</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td class="calc-param-name"><strong>Tracción</strong> (inferior)</td>
                                <td class="calc-value">${bd.As_req_flex.toFixed(2)} cm²</td>
                                <td class="calc-value" style="color: #00f2fe;">${bd.rebarBot.desc} (${bd.rebarBot.area.toFixed(2)} cm²)</td>
                                <td class="calc-value" style="font-weight:bold; color: ${bd.As_placed >= bd.As_req_flex ? 'var(--color-safe)' : 'var(--color-damage)'};">${bd.As_placed.toFixed(2)} cm²</td>
                                <td class="calc-value">${bd.rebarBotPlaced.desc} (${bd.rebarBotPlaced.area.toFixed(2)} cm²)</td>
                                <td class="calc-value">${statusIcon(bd.As_placed >= bd.As_req_flex)}</td>
                            </tr>
                            <tr>
                                <td class="calc-param-name"><strong>Compresión</strong> (superior)</td>
                                <td class="calc-value">${bd.AsPrime_req.toFixed(2)} cm²</td>
                                <td class="calc-value" style="color: #00f2fe;">${bd.rebarTop.desc} (${bd.rebarTop.area.toFixed(2)} cm²)</td>
                                <td class="calc-value" style="font-weight:bold; color: ${bd.AsPrime_placed >= bd.AsPrime_req ? 'var(--color-safe)' : 'var(--color-damage)'};">${bd.AsPrime_placed.toFixed(2)} cm²</td>
                                <td class="calc-value">${bd.rebarTopPlaced.desc} (${bd.rebarTopPlaced.area.toFixed(2)} cm²)</td>
                                <td class="calc-value">${statusIcon(bd.AsPrime_placed >= bd.AsPrime_req)}</td>
                            </tr>
                        </tbody>
                    </table>

                    <!-- Plano SVG -->
                    ${svgDrawing}
                </div>
            `;
        }

        reportHTML += `
            <div style="margin-top: 24px; margin-bottom: 24px; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 20px;">
                <h4 style="color: #00f2fe; margin-bottom: 10px; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; text-transform: uppercase; letter-spacing: 0.5px;">
                    <i class="fa-solid fa-ruler-combined"></i> Verificación y Diseño de Vigas — Teoría de Rotura
                </h4>
                <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px; line-height: 1.5;">
                    Comprobación de la viga configurada por <strong>teoría de rotura</strong> (flexión y cortante) y diseño correcto de estribos según
                    <strong>COVENIN 1756:2001</strong> y <strong>COVENIN 1756:2019</strong>. Incluye selección de cabillas comerciales venezolanas (COVENIN)
                    que cumplan con el área requerida y quepan físicamente en la sección.
                    Sección: <strong>${customSections.beamWidth}×${customSections.beamDepth} cm</strong> |
                    f'c: <strong>${customSections.fcBeam} kgf/cm²</strong> |
                    fy: <strong>${customSections.fyBeam} kgf/cm²</strong>
                </p>

                ${beamDesignHTML(beamX, `VIGA DIR. X — Luz: ${sX.toFixed(2)} m`)}
                ${twoDirections ? beamDesignHTML(beamY, `VIGA DIR. Y — Luz: ${sY.toFixed(2)} m`) : ''}
            </div>
        `;
    }


    // Inyectar el reporte de cálculos dinámicamente en el DOM
    initialReportHTML = reportHTML;
    updateCalculationReport();

    // Inicializar o limpiar gráficos de respuesta
    resetChartsData();

    // Actualizar visualización 3D estructural (reconstruir edificios con número correcto de pisos)
    rebuild3DStructures();
}

// --- REPORTE DE RESULTADOS DE COLUMNAS (MEMORIA DE CÁLCULO) ---
function updateCalculationReport() {
    const reportDiv = document.getElementById("calculation-report");
    if (!reportDiv) return;

    let html = initialReportHTML;

    // Si la simulación ha iniciado, añadir el reporte de columnas
    if (simStepIndex > 0) {
        let maxV_2001 = 0;
        if (eq2001 && eq2001.history && eq2001.history.groundShear) {
            maxV_2001 = Math.max(...eq2001.history.groundShear.map(Math.abs)) / G;
        }
        let maxV_2019 = 0;
        if (eq2019 && eq2019.history && eq2019.history.groundShear) {
            maxV_2019 = Math.max(...eq2019.history.groundShear.map(Math.abs)) / G;
        }

        // Cortantes basales de diseño (convertidos a kgf)
        const Vd_x_2001 = eq2001 && eq2001.V_design_x ? eq2001.V_design_x[0] / G : 0;
        const Vd_y_2001 = eq2001 && eq2001.V_design_y ? eq2001.V_design_y[0] / G : 0;
        const Vd_x_2019 = eq2019 && eq2019.V_design_x ? eq2019.V_design_x[0] / G : 0;
        const Vd_y_2019 = eq2019 && eq2019.V_design_y ? eq2019.V_design_y[0] / G : 0;

        html += `
            <div style="margin-top: 32px; border-top: 1px solid var(--border-color); padding-top: 24px;">
                <h4 style="color: #ffb703; margin-bottom: 12px; font-size: 14px; font-weight: 700; display: flex; align-items: center; gap: 8px; text-transform: uppercase; letter-spacing: 0.5px;">
                    <i class="fa-solid fa-gauge-high"></i> Comportamiento Sísmico Global Registrado (Sismo Real)
                </h4>
                <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 16px; line-height: 1.6;">
                    Este cuadro resume los valores globales pico medidos durante la simulación dinámica bajo el terremoto real (acelerograma con la PGA seleccionada) y los compara con las fuerzas de diseño normativas de partida. Todas las fuerzas se reportan en <strong>kilogramos-fuerza (kgf)</strong>, unidad estándar en la ingeniería estructural venezolana.
                </p>

                <table class="calc-table" style="margin-bottom: 24px; width: 100%;">
                    <thead>
                        <tr>
                            <th>Parámetro Estructural Global</th>
                            <th>Unidad</th>
                            <th>COVENIN 1756:2001</th>
                            <th>COVENIN 1756:2019</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td class="calc-param-name">Corte Basal de Diseño (Eje X)</td>
                            <td class="calc-unit">kgf</td>
                            <td class="calc-value" style="font-weight: bold; color: var(--color-2001);">${Math.round(Vd_x_2001).toLocaleString()}</td>
                            <td class="calc-value" style="font-weight: bold; color: var(--color-2019);">${Math.round(Vd_x_2019).toLocaleString()}</td>
                        </tr>
                        <tr>
                            <td class="calc-param-name">Corte Basal de Diseño (Eje Y)</td>
                            <td class="calc-unit">kgf</td>
                            <td class="calc-value" style="font-weight: bold; color: var(--color-2001);">${Math.round(Vd_y_2001).toLocaleString()}</td>
                            <td class="calc-value" style="font-weight: bold; color: var(--color-2019);">${Math.round(Vd_y_2019).toLocaleString()}</td>
                        </tr>
                        <tr style="background: rgba(255, 183, 3, 0.08); border-top: 1.5px solid rgba(255, 183, 3, 0.3); border-bottom: 1.5px solid rgba(255, 183, 3, 0.3);">
                            <td class="calc-param-name" style="font-weight: bold; color: #ffb703;">Corte Basal Máximo Registrado (Sismo Real)</td>
                            <td class="calc-unit" style="font-weight: bold; color: #ffb703;">kgf</td>
                            <td class="calc-value" style="font-weight: bold; color: #ffb703;">${Math.round(maxV_2001).toLocaleString()}</td>
                            <td class="calc-value" style="font-weight: bold; color: #ffb703;">${Math.round(maxV_2019).toLocaleString()}</td>
                        </tr>
                        <tr>
                            <td class="calc-param-name">Relación Demanda Real / Diseño (Eje X)</td>
                            <td class="calc-unit">-</td>
                            <td class="calc-value" style="font-weight: bold; color: ${maxV_2001 / Math.max(1, Vd_x_2001) > 1.0 ? 'var(--color-damage)' : 'var(--color-safe)'};">${Vd_x_2001 > 0 ? (maxV_2001 / Vd_x_2001).toFixed(2) : 'N/A'}</td>
                            <td class="calc-value" style="font-weight: bold; color: ${maxV_2019 / Math.max(1, Vd_x_2019) > 1.0 ? 'var(--color-damage)' : 'var(--color-safe)'};">${Vd_x_2019 > 0 ? (maxV_2019 / Vd_x_2019).toFixed(2) : 'N/A'}</td>
                        </tr>
                        <tr>
                            <td class="calc-param-name">Deriva Máxima de Entrepiso Registrada</td>
                            <td class="calc-unit">%</td>
                            <td class="calc-value" style="font-weight: bold; color: ${eq2001.maxDriftRatio > eq2001.driftCollapseLimit ? 'var(--color-damage)' : 'var(--color-safe)'};">${(eq2001.maxDriftRatio * 100).toFixed(3)}%</td>
                            <td class="calc-value" style="font-weight: bold; color: ${eq2019.maxDriftRatio > eq2019.driftCollapseLimit ? 'var(--color-damage)' : 'var(--color-safe)'};">${(eq2019.maxDriftRatio * 100).toFixed(3)}%</td>
                        </tr>
                        <tr>
                            <td class="calc-param-name">Límite Normativo de Deriva (Colapso)</td>
                            <td class="calc-unit">%</td>
                            <td class="calc-value" style="color: var(--text-muted);">${(eq2001.driftCollapseLimit * 100).toFixed(1)}%</td>
                            <td class="calc-value" style="color: var(--text-muted);">${(eq2019.driftCollapseLimit * 100).toFixed(1)}%</td>
                        </tr>
                        <tr style="background: rgba(255,255,255,0.02); border-top: 1px dashed rgba(255,255,255,0.1);">
                            <td class="calc-param-name" style="font-weight: bold;">Estado Final Estructural</td>
                            <td class="calc-unit">-</td>
                            <td class="calc-value" style="font-weight: bold; color: ${eq2001.isCollapsed ? 'var(--color-damage)' : 'var(--color-safe)'};">${eq2001.isCollapsed ? 'COLAPSO' : 'ESTABLE'}</td>
                            <td class="calc-value" style="font-weight: bold; color: ${eq2019.isCollapsed ? 'var(--color-damage)' : 'var(--color-safe)'};">${eq2019.isCollapsed ? 'COLAPSO' : 'ESTABLE'}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div style="margin-top: 24px; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 20px;">
                <h4 style="color: var(--color-2019); margin-bottom: 12px; font-size: 14px; font-weight: 700; display: flex; align-items: center; gap: 8px; text-transform: uppercase; letter-spacing: 0.5px;">
                    <i class="fa-solid fa-circle-notch"></i> Resumen de Derivas Locales y Rótulas en Columnas
                </h4>
                <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 16px; line-height: 1.6;">
                    Este cuadro detalla el estado final y la deriva de entrepiso máxima registrada en cada columna de forma individual. Nótese que debido al efecto de la excentricidad torsional, las columnas de un mismo piso pueden experimentar derivas distintas.
                </p>
                
                <div class="grid-columns-report" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px;">
                    <!-- Edificio 2001 -->
                    <div>
                        <h5 style="color: var(--color-2001); margin-bottom: 8px; font-size: 13px; font-weight: 600;">
                            <i class="fa-solid fa-hotel"></i> Edificio COVENIN 1756:2001
                        </h5>
                        ${generateColumnsTableHTML(buildings3D.b2001, eq2001)}
                    </div>
                    
                    <!-- Edificio 2019 -->
                    <div>
                        <h5 style="color: var(--color-2019); margin-bottom: 8px; font-size: 13px; font-weight: 600;">
                            <i class="fa-solid fa-hotel"></i> Edificio COVENIN 1756:2019
                        </h5>
                        ${generateColumnsTableHTML(buildings3D.b2019, eq2019)}
                    </div>
                </div>
            </div>
        `;
    }

    // --- VISUALIZACIÓN 3D DEL COMPORTAMIENTO REAL DE LA VIGA ---
    if (simStepIndex > 0 && lastBeamDesignX && lastStructuralConfig && eq2001 && eq2019) {
        html += `
            <div style="margin-top: 32px; border-top: 1px solid var(--border-color); padding-top: 24px;">
                <h4 style="color: #ffb703; margin-bottom: 12px; font-size: 14px; font-weight: 700; display: flex; align-items: center; gap: 8px; text-transform: uppercase; letter-spacing: 0.5px;">
                    <i class="fa-solid fa-cube"></i> Comportamiento Real de la Viga bajo Sismo Simulado
                </h4>
                <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 16px; line-height: 1.6;">
                    Visualización isométrica 3D del estado de la viga bajo el sismo real simulado, contrastando el comportamiento
                    de la estructura diseñada según COVENIN 2001 y COVENIN 2019. Posicione el cursor sobre la viga para explorar momentos reales, DCR local y daño en cualquier punto.
                </p>

                <!-- Controles interactivos de visualización -->
                <div style="display: flex; gap: 10px; margin-bottom: 16px; justify-content: center; align-items: center; flex-wrap: wrap; background: rgba(0,0,0,0.2); padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
                    <span style="font-size: 11px; color: var(--text-muted); font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">Visualización:</span>
                    <button class="btn" style="width: auto; padding: 4px 10px; font-size: 11px; border-radius: 4px; background: ${beamViewMode === 'xray' ? 'var(--color-2019)' : 'rgba(255,255,255,0.08)'}; color: ${beamViewMode === 'xray' ? '#000000' : '#ffffff'}; font-weight: 600; cursor: pointer; border: none;" onclick="changeBeamViewMode('xray')">
                        <i class="fa-solid fa-eye-slash"></i> Rayos-X (Acero y Estribos)
                    </button>
                    <button class="btn" style="width: auto; padding: 4px 10px; font-size: 11px; border-radius: 4px; background: ${beamViewMode === 'solid' ? 'var(--color-2019)' : 'rgba(255,255,255,0.08)'}; color: ${beamViewMode === 'solid' ? '#000000' : '#ffffff'}; font-weight: 600; cursor: pointer; border: none;" onclick="changeBeamViewMode('solid')">
                        <i class="fa-solid fa-shapes"></i> Superficie Sólida (Daño)
                    </button>
                    <span style="width: 15px; height: 12px; border-right: 1px solid rgba(255,255,255,0.15);"></span>
                    <button class="btn" style="width: auto; padding: 4px 10px; font-size: 11px; border-radius: 4px; background: ${beamAnimActive ? '#ffb703' : 'rgba(255,255,255,0.08)'}; color: ${beamAnimActive ? '#000000' : '#ffffff'}; font-weight: 600; cursor: pointer; border: none;" onclick="toggleBeamAnimation()">
                        <i class="fa-solid ${beamAnimActive ? 'fa-pause' : 'fa-play'}"></i> ${beamAnimActive ? 'Pausar Vibración' : 'Animar Vibración'}
                    </button>
                    <button class="btn" style="width: auto; padding: 4px 10px; font-size: 11px; border-radius: 4px; background: rgba(255,255,255,0.08); color: #ffffff; font-weight: 600; cursor: pointer; border: none;" onclick="resetBeamView()">
                        <i class="fa-solid fa-rotate-left"></i> Restablecer Vista
                    </button>
                </div>

                <div style="margin-bottom: 16px;">
                    <canvas id="beam3d-canvas-x" width="780" height="420" style="width:100%;max-width:780px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);display:block;margin:0 auto;"></canvas>
                </div>
        `;

        if (lastBeamDesignY) {
            html += `
                <div style="margin-top: 12px;">
                    <canvas id="beam3d-canvas-y" width="780" height="420" style="width:100%;max-width:780px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);display:block;margin:0 auto;"></canvas>
                </div>
            `;
        }

        html += `</div>`;
    }

    // Intentar capturar los gráficos para anexarlos a la memoria de cálculo
    try {
        const spectraCanvas = document.getElementById("spectra-chart");
        const accelCanvas = document.getElementById("accel-chart");
        const dispCanvas = document.getElementById("disp-chart");
        const hyst2001Canvas = document.getElementById("hysteresis-2001-chart");
        const hyst2019Canvas = document.getElementById("hysteresis-2019-chart");

        const hasSpectra = spectraCanvas && spectraCanvas.width > 0;
        const hasSimResults = simStepIndex > 0 && accelCanvas && accelCanvas.width > 0 && dispCanvas && dispCanvas.width > 0 && hyst2001Canvas && hyst2019Canvas;

        if (hasSpectra || hasSimResults) {
            html += `
                <div class="print-charts-section">
                    <h4 style="color: var(--color-2019); margin-bottom: 16px; font-size: 14px; font-weight: 700; display: flex; align-items: center; gap: 8px; text-transform: uppercase; letter-spacing: 0.5px;">
                        <i class="fa-solid fa-chart-area"></i> Registro Gráfico de Resultados
                    </h4>
                    <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 16px; line-height: 1.6;">
                        A continuación se presenta el registro visual de los espectros de diseño empleados, los registros en el tiempo y el comportamiento de histéresis no-lineal.
                    </p>
                    
                    <div style="display: flex; flex-direction: column; gap: 20px;">
            `;

            if (hasSpectra) {
                html += `
                        <div class="print-chart-card">
                            <h5>Espectros de Respuesta de Diseño (COVENIN 1756)</h5>
                            <img src="${spectraCanvas.toDataURL()}" style="max-height: 280px;" />
                        </div>
                `;
            }

            if (hasSimResults) {
                html += `
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                            <div class="print-chart-card">
                                <h5>Aceleración del Terreno (a<sub>g</sub>)</h5>
                                <img src="${accelCanvas.toDataURL()}" style="max-height: 180px;" />
                            </div>
                            <div class="print-chart-card">
                                <h5>Registro de Desplazamientos del Techo (x<sub>N</sub>)</h5>
                                <img src="${dispCanvas.toDataURL()}" style="max-height: 180px;" />
                            </div>
                        </div>

                        <div class="print-chart-card">
                            <h5>Curvas de Histéresis del Primer Piso (Cortante de Piso vs Deriva de Piso)</h5>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                                <div style="text-align: center;">
                                    <img src="${hyst2001Canvas.toDataURL()}" style="max-height: 200px;" />
                                    <div style="font-size: 11px; margin-top: 4px; color: var(--color-2001); font-weight: bold;">COVENIN 2001</div>
                                </div>
                                <div style="text-align: center;">
                                    <img src="${hyst2019Canvas.toDataURL()}" style="max-height: 200px;" />
                                    <div style="font-size: 11px; margin-top: 4px; color: var(--color-2019); font-weight: bold;">COVENIN 2019</div>
                                </div>
                            </div>
                        </div>
                `;
            }

            html += `
                    </div>
                </div>
            `;
        }
    } catch (e) {
        console.error("Error al exportar gráficos de Chart.js:", e);
    }

    reportDiv.innerHTML = html;

    // Renderizar los canvas 3D de vigas después de que el DOM se actualice
    if (simStepIndex > 0 && lastBeamDesignX && lastStructuralConfig && eq2001 && eq2019) {
        requestAnimationFrame(() => {
            try {
                renderBeam3DCanvas('beam3d-canvas-x', lastBeamDesignX, eq2001, eq2019, lastStructuralConfig, 'X');
                if (lastBeamDesignY) {
                    renderBeam3DCanvas('beam3d-canvas-y', lastBeamDesignY, eq2001, eq2019, lastStructuralConfig, 'Y');
                }
            } catch (e) {
                console.error('Error renderizando visualización 3D de vigas:', e);
            }
        });
    }
}

// Funciones globales para cambiar vista de vigas 3D e iniciar/pausar animación
function changeBeamViewMode(mode) {
    beamViewMode = mode;
    updateCalculationReport();
}

function toggleBeamAnimation() {
    beamAnimActive = !beamAnimActive;
    updateCalculationReport();
}

function resetBeamView() {
    beamRotX = { X: -0.15, Y: -0.15 };
    beamRotY = { X: 0.35, Y: 0.35 };
    beamPanX = { X: 0, Y: 0 };
    beamPanY = { X: 0, Y: 0 };
    updateCalculationReport();
}

function generateColumnsTableHTML(b3D, bModel) {
    if (!b3D || !b3D.columns || b3D.columns.length === 0) {
        return '<p style="color: var(--text-muted); font-size: 12px;">Sin datos en el modelo 3D.</p>';
    }

    let html = `
        <table class="calc-table">
            <thead>
                <tr>
                    <th>Piso</th>
                    <th>Columna (X, Y)</th>
                    <th>Deriva Máx</th>
                    <th>Estado Final</th>
                </tr>
            </thead>
            <tbody>
    `;

    b3D.columns.forEach((storyCols, lvl) => {
        storyCols.forEach((col) => {
            const maxDrift = col.maxDriftRatio || 0;
            const maxDriftPercent = (maxDrift * 100).toFixed(2) + "%";

            let statusText = "Seguro";
            let statusStyle = "color: var(--color-safe); font-weight: bold;";

            if (maxDrift >= bModel.driftCollapseLimit || bModel.D_max[lvl] >= 0.99) {
                statusText = "Colapso / Fallo";
                statusStyle = "color: var(--color-damage); font-weight: bold;";
            } else if (maxDrift >= 0.018) {
                statusText = "Rótula Roja (Severo)";
                statusStyle = "color: #ff1744; font-weight: bold;";
            } else if (maxDrift >= 0.015) {
                statusText = "Rótula Amarilla (Fluencia)";
                statusStyle = "color: #ffca28; font-weight: bold;";
            }

            html += `
                <tr>
                    <td class="calc-symbol" style="font-weight: normal; color: #fff;">Piso ${lvl + 1}</td>
                    <td class="calc-param-name">Columna (${col.ix + 1}, ${col.iy + 1})</td>
                    <td class="calc-value">${maxDriftPercent}</td>
                    <td class="calc-unit" style="${statusStyle}">${statusText}</td>
                </tr>
            `;
        });
    });

    html += `
            </tbody>
        </table>
    `;
    return html;
}

// --- GRÁFICOS CON CHART.JS ---
function drawSpectraChart(p01, p19, T_fund_x, T_fund_y) {
    const ctx = document.getElementById("spectra-chart").getContext("2d");

    // Generar datos para las curvas
    const data2001 = [];
    const data2019 = [];

    for (let t = 0.01; t <= 4.0; t += 0.02) {
        data2001.push({ x: t, y: getSpectrum2001(t, p01) });
        data2019.push({ x: t, y: getSpectrum2019(t, p19) });
    }

    if (spectraChartInstance) {
        spectraChartInstance.destroy();
    }

    const verticalLinePlugin = {
        id: 'verticalLine',
        afterDraw: (chart) => {
            const ctx = chart.ctx;
            const xAxis = chart.scales.x;
            const yAxis = chart.scales.y;

            const drawLine = (T_val, label, color) => {
                if (T_val) {
                    const xPos = xAxis.getPixelForValue(T_val);

                    if (xPos >= xAxis.left && xPos <= xAxis.right) {
                        ctx.save();
                        ctx.beginPath();
                        ctx.strokeStyle = color;
                        ctx.lineWidth = 1.5;
                        ctx.setLineDash([4, 4]);
                        ctx.moveTo(xPos, yAxis.top);
                        ctx.lineTo(xPos, yAxis.bottom);
                        ctx.stroke();

                        // Draw a label text
                        ctx.fillStyle = color;
                        ctx.font = '10px Inter';
                        ctx.textAlign = 'center';
                        ctx.fillText(`${label} = ${T_val.toFixed(2)}s`, xPos, yAxis.top - 8);
                        ctx.restore();
                    }
                }
            };

            drawLine(T_fund_x, 'T_x', '#00b4d8');
            drawLine(T_fund_y, 'T_y', '#ff007f');
        }
    };

    spectraChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'COVENIN 1756:2001',
                    data: data2001,
                    borderColor: '#00b4d8',
                    borderWidth: 2,
                    pointRadius: 0,
                    fill: false
                },
                {
                    label: 'COVENIN 1756-1:2019',
                    data: data2019,
                    borderColor: '#ff007f',
                    borderWidth: 2,
                    pointRadius: 0,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 0 },
            scales: {
                x: {
                    type: 'linear',
                    title: { display: true, text: 'Período de Vibración T (s)', color: '#94a3b8' },
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#94a3b8' },
                    min: 0,
                    max: 4.0
                },
                y: {
                    title: { display: true, text: 'Aceleración Espectral de Diseño Ad (g)', color: '#94a3b8' },
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#94a3b8' },
                    min: 0
                }
            },
            plugins: {
                legend: { labels: { color: '#f8fafc' } },
                tooltip: { intersect: false, mode: 'index' }
            }
        },
        plugins: [verticalLinePlugin]
    });
}

function resetChartsData() {
    // Acelerograma del terreno
    const ctxAccel = document.getElementById("accel-chart").getContext("2d");
    if (accelChartInstance) accelChartInstance.destroy();

    // Solo mostrar una porción inicial vacía o la señal completa pero sin cursor
    accelChartInstance = new Chart(ctxAccel, {
        type: 'line',
        data: {
            labels: timeSeries.filter((_, i) => i % 10 === 0), // diezmar para velocidad
            datasets: [{
                label: 'Aceleración (g)',
                data: groundAccel.filter((_, i) => i % 10 === 0),
                borderColor: '#94a3b8',
                borderWidth: 1,
                pointRadius: 0,
                fill: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 0 },
            scales: {
                x: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { display: false } },
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
            },
            plugins: { legend: { display: false } }
        }
    });

    // Desplazamiento techo
    const ctxDisp = document.getElementById("disp-chart").getContext("2d");
    if (dispChartInstance) dispChartInstance.destroy();
    dispChartInstance = new Chart(ctxDisp, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'COVENIN 2001',
                    data: [],
                    borderColor: '#00b4d8',
                    borderWidth: 1.5,
                    pointRadius: 0,
                    fill: false
                },
                {
                    label: 'COVENIN 2019',
                    data: [],
                    borderColor: '#ff007f',
                    borderWidth: 1.5,
                    pointRadius: 0,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 0 },
            scales: {
                x: { title: { display: true, text: 'Tiempo (s)', color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#94a3b8', maxTicksLimit: 10 } },
                y: { title: { display: true, text: 'Desplazamiento (m)', color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
            },
            plugins: { legend: { display: false } }
        }
    });

    // Histéresis 2001
    const ctxHyst2001 = document.getElementById("hysteresis-2001-chart").getContext("2d");
    if (hyst2001ChartInstance) hyst2001ChartInstance.destroy();
    hyst2001ChartInstance = new Chart(ctxHyst2001, {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'Histéresis 2001',
                data: [],
                borderColor: '#00b4d8',
                backgroundColor: 'rgba(0, 180, 216, 0.1)',
                showLine: true,
                borderWidth: 1.5,
                pointRadius: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 0 },
            scales: {
                x: { title: { display: true, text: 'Deriva del 1er Piso (%)', color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#94a3b8' } },
                y: { title: { display: true, text: 'Fuerza Cortante (kN)', color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
            },
            plugins: { legend: { display: false } }
        }
    });

    // Histéresis 2019
    const ctxHyst2019 = document.getElementById("hysteresis-2019-chart").getContext("2d");
    if (hyst2019ChartInstance) hyst2019ChartInstance.destroy();
    hyst2019ChartInstance = new Chart(ctxHyst2019, {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'Histéresis 2019',
                data: [],
                borderColor: '#ff007f',
                backgroundColor: 'rgba(255, 0, 127, 0.1)',
                showLine: true,
                borderWidth: 1.5,
                pointRadius: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 0 },
            scales: {
                x: { title: { display: true, text: 'Deriva del 1er Piso (%)', color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#94a3b8' } },
                y: { title: { display: true, text: 'Fuerza Cortante (kN)', color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

// Actualizar gráficos en tiempo real con decimación para mejorar performance
function updateChartsRealTime(step) {
    if (step % 5 !== 0) return; // solo actualizar cada 5 pasos de tiempo para evitar lag

    const t = currentTime;
    const decimation = 5;

    // Desplazamiento
    if (dispChartInstance) {
        const labels = dispChartInstance.data.labels;
        const data1 = dispChartInstance.data.datasets[0].data;
        const data2 = dispChartInstance.data.datasets[1].data;

        labels.push(t.toFixed(1));
        data1.push(eq2001.x[eq2001.N - 1]);
        data2.push(eq2019.x[eq2019.N - 1]);

        // Mantener solo los últimos 300 puntos para evitar saturación
        if (labels.length > 300) {
            labels.shift();
            data1.shift();
            data2.shift();
        }
        dispChartInstance.update('none');
    }

    // Histéresis (Cortante de base vs Deriva de primer piso)
    // storyForces[0] es la fuerza cortante. u = x[0]/h es la deriva de primer piso.
    if (hyst2001ChartInstance && !eq2001.isCollapsed) {
        const data = hyst2001ChartInstance.data.datasets[0].data;
        const driftPercent = (eq2001.x[0] / eq2001.h) * 100;
        const force_kN = eq2001.history.groundShear[eq2001.history.groundShear.length - 1] / 1000; // N a kN

        data.push({ x: driftPercent, y: force_kN });
        if (data.length > 1000) data.shift();
        hyst2001ChartInstance.update('none');
    }

    if (hyst2019ChartInstance && !eq2019.isCollapsed) {
        const data = hyst2019ChartInstance.data.datasets[0].data;
        const driftPercent = (eq2019.x[0] / eq2019.h) * 100;
        const force_kN = eq2019.history.groundShear[eq2019.history.groundShear.length - 1] / 1000;

        data.push({ x: driftPercent, y: force_kN });
        if (data.length > 1000) data.shift();
        hyst2019ChartInstance.update('none');
    }
}

// --- SIMULACIÓN 3D CON THREE.JS ---
function initThreeJS() {
    const container = document.getElementById("canvas-3d-container");

    // Crear Escena
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x090a0f, 0.015);

    // Cámara
    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(0, 8, 25);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // Controles
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.02; // no pasar por debajo del suelo
    controls.minDistance = 5;
    controls.maxDistance = 60;

    // Luces
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(10, 20, 15);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 50;
    const d = 15;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    scene.add(dirLight);

    // Suelo base vibrante
    const groundGeometry = new THREE.BoxGeometry(30, 0.5, 12);
    const groundMaterial = new THREE.MeshStandardMaterial({
        color: 0x1a2130,
        roughness: 0.8,
        metalness: 0.1
    });
    groundPlane = new THREE.Mesh(groundGeometry, groundMaterial);
    groundPlane.position.y = -0.25;
    groundPlane.receiveShadow = true;
    scene.add(groundPlane);

    // Rejilla de fondo decorativa
    gridHelper = new THREE.GridHelper(40, 20, 0x475569, 0x1e293b);
    gridHelper.position.y = 0.01;
    scene.add(gridHelper);

    // --- EJES IDENTIFICADOS X / Y ---
    createAxisIndicators();

    // Partículas de polvo/humo
    initParticles();

    // Flechas indicadoras de fuerza cortante base
    createBaseShearArrows();

    // Evento de selección de columnas por click 3D (Raycasting con prevención de arrastre de cámara)
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let startX = 0, startY = 0;

    renderer.domElement.addEventListener('pointerdown', (e) => {
        startX = e.clientX;
        startY = e.clientY;
    });

    renderer.domElement.addEventListener('pointerup', (e) => {
        const diffX = Math.abs(e.clientX - startX);
        const diffY = Math.abs(e.clientY - startY);
        if (diffX > 3 || diffY > 3) return; // Arrastre detectado, ignorar click

        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);

        const targets = [];
        const colMap = new Map();

        const addCols = (b3D, bName) => {
            if (!b3D.columns) return;
            b3D.columns.forEach((storyCols, lvl) => {
                storyCols.forEach((col, idx) => {
                    if (col.meshes && Array.isArray(col.meshes)) {
                        col.meshes.forEach(segMesh => {
                            targets.push(segMesh);
                            colMap.set(segMesh, { buildingName: bName, level: lvl, index: idx, colData: col });
                        });
                    } else if (col.mesh) {
                        targets.push(col.mesh);
                        colMap.set(col.mesh, { buildingName: bName, level: lvl, index: idx, colData: col });
                    }
                });
            });
        };

        addCols(buildings3D.b2001, 'Edificio COVENIN 1756:2001');
        addCols(buildings3D.b2019, 'Edificio COVENIN 1756:2019');

        const intersects = raycaster.intersectObjects(targets);
        if (intersects.length > 0) {
            const hitMesh = intersects[0].object;
            const info = colMap.get(hitMesh);
            if (info) {
                selectColumn(info);
            }
        } else {
            deselectColumn();
        }
    });

    // Botón de cerrar panel de columna
    const closeBtn = document.getElementById("close-column-info");
    if (closeBtn) {
        closeBtn.addEventListener("click", () => {
            deselectColumn();
        });
    }

    // Evento resize
    window.addEventListener("resize", () => {
        const width = container.clientWidth;
        const height = container.clientHeight;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
    });
}

// --- SELECCIÓN Y DETALLES DE COLUMNAS EN 3D ---
function updateSelectedColumnPanel() {
    if (!selectedColumn) return;

    const col = selectedColumn.colData;
    const maxDrift = col.maxDriftRatio || 0;
    const maxDriftPercent = (maxDrift * 100).toFixed(2) + "%";

    document.getElementById("col-info-building").textContent = selectedColumn.buildingName;
    document.getElementById("col-info-level").textContent = `Piso ${selectedColumn.level + 1}`;
    document.getElementById("col-info-pos").textContent = `Fila ${col.ix + 1}, Eje ${col.iy + 1}`;
    document.getElementById("col-info-drift").textContent = maxDriftPercent;

    let statusText = "Seguro";
    let statusClass = "text-green";

    const bModel = selectedColumn.buildingName.includes("2019") ? eq2019 : eq2001;
    if (maxDrift >= bModel.driftCollapseLimit || bModel.D_max[selectedColumn.level] >= 0.99) {
        statusText = "Colapsada";
        statusClass = "text-red animate-pulse";
    } else if (maxDrift >= 0.018) {
        statusText = "Daño Severo";
        statusClass = "text-red";
    } else if (maxDrift >= 0.015) {
        statusText = "Fluencia (Plástica)";
        statusClass = "text-yellow";
    }

    const statusEl = document.getElementById("col-info-status");
    if (statusEl) {
        statusEl.textContent = statusText;
        statusEl.className = "info-val " + statusClass;
    }
}

function selectColumn(info) {
    // Limpiar selección anterior si existiese
    deselectColumn();

    selectedColumn = info;
    const panel = document.getElementById("column-info-panel");
    if (panel) panel.style.display = "block";
    updateSelectedColumnPanel();

    const colMesh = info.colData.mesh;

    // 1. Crear sleeve semi-transparente dorado alrededor de la columna
    const glowMat = new THREE.MeshBasicMaterial({
        color: 0xffca28,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    selectionHighlightMesh = new THREE.Mesh(colMesh.geometry, glowMat);
    // Un 15% más grande en planta, mismo alto
    selectionHighlightMesh.scale.set(1.15, 1.005, 1.15);
    colMesh.add(selectionHighlightMesh);

    // 2. Crear marco alambrado (Edges) dorado para destacar bordes
    const edges = new THREE.EdgesGeometry(colMesh.geometry);
    const lineMat = new THREE.LineBasicMaterial({
        color: 0xffd700,
        depthWrite: false
    });
    selectionHighlightOutline = new THREE.LineSegments(edges, lineMat);
    // Un 15.5% más grande para que no haga z-fighting
    selectionHighlightOutline.scale.set(1.155, 1.005, 1.155);
    colMesh.add(selectionHighlightOutline);
}

function deselectColumn() {
    selectedColumn = null;
    const panel = document.getElementById("column-info-panel");
    if (panel) panel.style.display = "none";

    if (selectionHighlightMesh) {
        if (selectionHighlightMesh.parent) {
            selectionHighlightMesh.parent.remove(selectionHighlightMesh);
        }
        selectionHighlightMesh.material.dispose();
        selectionHighlightMesh = null;
    }

    if (selectionHighlightOutline) {
        if (selectionHighlightOutline.parent) {
            selectionHighlightOutline.parent.remove(selectionHighlightOutline);
        }
        selectionHighlightOutline.geometry.dispose();
        selectionHighlightOutline.material.dispose();
        selectionHighlightOutline = null;
    }
}

// --- INDICADORES DE FUERZA CORTANTE BASE (CORTE BASAL) ---
function createBaseShearArrows() {
    if (arrow2001 && arrow2001.parent) arrow2001.parent.remove(arrow2001);
    if (arrow2019 && arrow2019.parent) arrow2019.parent.remove(arrow2019);

    const dir = new THREE.Vector3(1, 0, 0);
    const origin = new THREE.Vector3(0, 0, 0);

    // Colores: Cyan (0x00ffcc) para 2001 y Rosa/Magenta (0xff007f) para 2019
    arrow2001 = new THREE.ArrowHelper(dir, origin, 1.0, 0x00ffcc, 0.4, 0.3);
    arrow2019 = new THREE.ArrowHelper(dir, origin, 1.0, 0xff007f, 0.4, 0.3);

    arrow2001.visible = false;
    arrow2019.visible = false;

    scene.add(arrow2001);
    scene.add(arrow2019);
}

function updateBaseShearArrows(isX, xOffset, bD, groundDisp) {
    if (!arrow2001 || !arrow2019) return;

    if (!isPlaying) {
        arrow2001.visible = false;
        arrow2019.visible = false;
        return;
    }

    // Fuerza de diseño o máxima de referencia (30% del peso del edificio)
    const maxExpectedForce2001 = eq2001.m * eq2001.N * 9.80665 * 0.3;
    const maxExpectedForce2019 = eq2019.m * eq2019.N * 9.80665 * 0.3;

    const force2001 = eq2001.currentBaseShear || 0;
    const force2019 = eq2019.currentBaseShear || 0;

    // Actualizar flecha 2001 (lado izquierdo, offset negativo)
    updateSingleBaseShearArrow(arrow2001, force2001, maxExpectedForce2001, -xOffset, bD, isX, groundDisp);

    // Actualizar flecha 2019 (lado derecho, offset positivo)
    updateSingleBaseShearArrow(arrow2019, force2019, maxExpectedForce2019, xOffset, bD, isX, groundDisp);
}

function updateSingleBaseShearArrow(arrow, forceVal, maxExpected, xOffsetPos, bD, isX, groundDisp) {
    if (Math.abs(forceVal) < 1.0) {
        arrow.visible = false;
        return;
    }

    arrow.visible = true;

    // Dirección del vector de fuerza
    const dir = new THREE.Vector3(0, 0, 0);
    if (isX) {
        dir.set(Math.sign(forceVal), 0, 0);
    } else {
        // El eje Y en planta del simulador equivale al eje -Z de Three.js
        dir.set(0, 0, -Math.sign(forceVal));
    }
    arrow.setDirection(dir);

    // Longitud (proporcional, máx 4.5m, mín 0.4m)
    const rawLength = (Math.abs(forceVal) / maxExpected) * 3.5;
    const length = Math.max(0.4, Math.min(4.5, rawLength));
    const headLength = Math.max(0.15, length * 0.25);
    const headWidth = Math.max(0.12, length * 0.18);
    arrow.setLength(length, headLength, headWidth);

    // Posición: justo al frente de la losa base y vibrando en fase con el terreno
    const currentX = xOffsetPos + (isX ? groundDisp : 0);
    const currentZ = (isX ? 0 : groundDisp) + bD / 2 + 1.2;
    arrow.position.set(currentX, 0.3, currentZ);
}
// --- INDICADORES DE EJES X / Y ---
let axisIndicatorsGroup = null;

function createAxisLabel(text, color) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 128;
    canvas.height = 64;

    // Fondo semitransparente con bordes redondeados
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    const r = 10;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(canvas.width - r, 0);
    ctx.quadraticCurveTo(canvas.width, 0, canvas.width, r);
    ctx.lineTo(canvas.width, canvas.height - r);
    ctx.quadraticCurveTo(canvas.width, canvas.height, canvas.width - r, canvas.height);
    ctx.lineTo(r, canvas.height);
    ctx.quadraticCurveTo(0, canvas.height, 0, canvas.height - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();
    ctx.fill();

    // Borde coloreado
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Texto
    ctx.font = 'bold 36px Inter, sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const spriteMat = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(2.0, 1.0, 1);
    return sprite;
}

function createAxisIndicators() {
    if (axisIndicatorsGroup) {
        scene.remove(axisIndicatorsGroup);
    }
    axisIndicatorsGroup = new THREE.Group();

    const origin = new THREE.Vector3(-14, 0.1, 5);
    const arrowLength = 4;
    const headLength = 0.6;
    const headWidth = 0.3;

    // Eje X → Three.js +X (cian, 0x00b4d8)
    const xDir = new THREE.Vector3(1, 0, 0);
    const xColor = 0x00b4d8;
    const xArrow = new THREE.ArrowHelper(xDir, origin, arrowLength, xColor, headLength, headWidth);
    xArrow.line.material.linewidth = 2;
    axisIndicatorsGroup.add(xArrow);

    const xLabel = createAxisLabel('Eje X', '#00b4d8');
    xLabel.position.set(origin.x + arrowLength + 1.2, origin.y + 0.5, origin.z);
    axisIndicatorsGroup.add(xLabel);

    // Eje Y → Three.js -Z (rosa, 0xff007f) 
    // En la escena, el eje Y del simulador corresponde al eje -Z de Three.js
    const yDir = new THREE.Vector3(0, 0, -1);
    const yColor = 0xff007f;
    const yArrow = new THREE.ArrowHelper(yDir, origin, arrowLength, yColor, headLength, headWidth);
    yArrow.line.material.linewidth = 2;
    axisIndicatorsGroup.add(yArrow);

    const yLabel = createAxisLabel('Eje Y', '#ff007f');
    yLabel.position.set(origin.x, origin.y + 0.5, origin.z - arrowLength - 1.2);
    axisIndicatorsGroup.add(yLabel);

    // Etiqueta de origen
    const originLabel = createAxisLabel('O', '#94a3b8');
    originLabel.position.set(origin.x - 0.6, origin.y + 0.5, origin.z + 0.6);
    originLabel.scale.set(1.0, 0.5, 1);
    axisIndicatorsGroup.add(originLabel);

    scene.add(axisIndicatorsGroup);
}

function createPersonModel(colorTheme) {
    const personGroup = new THREE.Group();

    // Materiales únicos por persona
    const mainColor = colorTheme === '2001' ? 0x00ff66 : 0x00ffcc;
    const bodyMat = new THREE.MeshStandardMaterial({
        color: mainColor,
        roughness: 0.4,
        metalness: 0.1,
        emissive: mainColor,
        emissiveIntensity: 0.25
    });

    const headMat = new THREE.MeshStandardMaterial({
        color: 0xffdbac, // Piel
        roughness: 0.6,
        metalness: 0.0
    });

    const clothesColor = colorTheme === '2001' ? 0x2563eb : 0xdb2777; // Ropa
    const pantsMat = new THREE.MeshStandardMaterial({
        color: clothesColor,
        roughness: 0.5
    });

    // 1. Tronco / Torso (cuerpo)
    const torsoGeom = new THREE.BoxGeometry(0.16, 0.3, 0.08);
    const torsoMesh = new THREE.Mesh(torsoGeom, bodyMat);
    torsoMesh.position.y = 0.35; // Altura local sobre la base
    torsoMesh.castShadow = true;
    personGroup.add(torsoMesh);

    // 2. Cabeza
    const headGeom = new THREE.SphereGeometry(0.08, 12, 12);
    const headMesh = new THREE.Mesh(headGeom, headMat);
    headMesh.position.y = 0.55;
    headMesh.castShadow = true;
    personGroup.add(headMesh);

    // 3. Pierna Izquierda (con pivote en cadera)
    const legGeom = new THREE.BoxGeometry(0.05, 0.2, 0.05);
    const leftLegPivot = new THREE.Group();
    leftLegPivot.position.set(-0.05, 0.2, 0);
    const leftLegMesh = new THREE.Mesh(legGeom, pantsMat);
    leftLegMesh.position.y = -0.1;
    leftLegMesh.castShadow = true;
    leftLegPivot.add(leftLegMesh);
    personGroup.add(leftLegPivot);

    // 4. Pierna Derecha (con pivote en cadera)
    const rightLegPivot = new THREE.Group();
    rightLegPivot.position.set(0.05, 0.2, 0);
    const rightLegMesh = new THREE.Mesh(legGeom, pantsMat);
    rightLegMesh.position.y = -0.1;
    rightLegMesh.castShadow = true;
    rightLegPivot.add(rightLegMesh);
    personGroup.add(rightLegPivot);

    // 5. Brazo Izquierdo (con pivote en hombro)
    const armGeom = new THREE.BoxGeometry(0.04, 0.2, 0.04);
    const leftArmPivot = new THREE.Group();
    leftArmPivot.position.set(-0.1, 0.45, 0);
    const leftArmMesh = new THREE.Mesh(armGeom, bodyMat);
    leftArmMesh.position.y = -0.1;
    leftArmMesh.castShadow = true;
    leftArmPivot.add(leftArmMesh);
    personGroup.add(leftArmPivot);

    // 6. Brazo Derecho (con pivote en hombro)
    const rightArmPivot = new THREE.Group();
    rightArmPivot.position.set(0.1, 0.45, 0);
    const rightArmMesh = new THREE.Mesh(armGeom, bodyMat);
    rightArmMesh.position.y = -0.1;
    rightArmMesh.castShadow = true;
    rightArmPivot.add(rightArmMesh);
    personGroup.add(rightArmPivot);

    // Almacenar referencias para animaciones
    personGroup.userData = {
        leftLeg: leftLegPivot,
        rightLeg: rightLegPivot,
        leftArm: leftArmPivot,
        rightArm: rightArmPivot,
        torso: torsoMesh,
        head: headMesh,
        mats: [bodyMat, headMat, pantsMat]
    };

    personGroup.scale.set(1.2, 1.2, 1.2);
    return personGroup;
}

function animatePerson(personGroup, animType) {
    const data = personGroup.userData;
    if (!data) return;

    const time = currentTime;

    if (animType === 'idle') {
        // Respiración en reposo
        const bob = Math.sin(time * 2) * 0.015;
        data.torso.position.y = 0.35 + bob;
        data.head.position.y = 0.55 + bob;

        data.leftArm.rotation.z = 0.15;
        data.rightArm.rotation.z = -0.15;
        data.leftArm.rotation.x = 0;
        data.rightArm.rotation.x = 0;
        data.leftLeg.rotation.x = 0;
        data.rightLeg.rotation.x = 0;
        personGroup.rotation.x = 0;
        personGroup.rotation.z = 0;
    } else if (animType === 'running') {
        const runSpeed = 15;
        const swing = Math.sin(time * runSpeed);

        // Piernas alternando
        data.leftLeg.rotation.x = swing * 0.7;
        data.rightLeg.rotation.x = -swing * 0.7;

        // Brazos alternando (opuestos a las piernas)
        data.leftArm.rotation.x = -swing * 0.8;
        data.rightArm.rotation.x = swing * 0.8;
        data.leftArm.rotation.z = 0.1;
        data.rightArm.rotation.z = -0.1;

        // Inclinación
        data.torso.rotation.x = 0.15;

        // Oscilación vertical
        const bob = Math.abs(Math.sin(time * runSpeed * 2)) * 0.04;
        data.torso.position.y = 0.35 - 0.02 + bob;
        data.head.position.y = 0.55 - 0.02 + bob;

        personGroup.rotation.x = 0;
        personGroup.rotation.z = 0;
    } else if (animType === 'trapped') {
        // Lying down
        personGroup.rotation.x = Math.PI / 2;

        data.leftLeg.rotation.x = 0.3;
        data.rightLeg.rotation.x = -0.2;
        data.leftArm.rotation.x = -0.5;
        data.rightArm.rotation.x = 0.4;
        data.leftArm.rotation.z = 0.5;
        data.rightArm.rotation.z = -0.5;
        data.torso.rotation.x = 0;

        data.torso.position.y = 0.35;
        data.head.position.y = 0.55;
    }
}

function createEvacuationGroup(bData, N, h, bW, bD) {
    if (bData.evacMeshes) {
        bData.evacMeshes.forEach(mesh => {
            if (mesh.parent) mesh.parent.remove(mesh);
        });
    }
    bData.evacMeshes = [];

    const mode = document.getElementById("evacuation-mode").value;
    if (mode === "off") {
        return [];
    }

    const topFloorY = N * h + 0.1;

    // Distribuir
    const offsets = [
        { x: -0.5, z: -0.5 },
        { x: 0.5, z: -0.5 },
        { x: -0.5, z: 0.5 },
        { x: 0.5, z: 0.5 }
    ];

    const meshes = [];

    for (let i = 0; i < 4; i++) {
        const mesh = createPersonModel(bData === buildings3D.b2001 ? '2001' : '2019');
        mesh.position.set(offsets[i].x, topFloorY, offsets[i].z);
        bData.group.add(mesh);
        meshes.push(mesh);
    }

    bData.evacMeshes = meshes;
    return meshes;
}

function updateEvacuation(evacState, bModel, b3D, N, h, isLeft) {
    if (!evacState || !evacState.meshes || evacState.meshes.length === 0) return;

    const mode = document.getElementById("evacuation-mode").value;
    if (mode === "off") {
        evacState.meshes.forEach(m => m.visible = false);
        return;
    }
    evacState.meshes.forEach(m => m.visible = true);

    if (evacState.trapped) {
        const floorIdx = evacState.currentFloor - 1;
        if (floorIdx >= 0 && floorIdx < b3D.floors.length) {
            const floorMesh = b3D.floors[floorIdx];
            evacState.meshes.forEach((mesh, i) => {
                mesh.position.y = floorMesh.position.y + 0.1;
                animatePerson(mesh, 'trapped');

                mesh.userData.mats.forEach(mat => {
                    if (mat.color.getHex() !== 0xff0000) {
                        mat.color.setHex(0xff0000);
                        if (mat.emissive) mat.emissive.setHex(0xff0000);
                    }
                });
            });
        }
        return;
    }

    if (evacState.escaped) {
        evacState.meshes.forEach((mesh, i) => {
            mesh.position.y = 0.1;
            const step = 0.05;
            if (isLeft) {
                if (mesh.position.x > -8) mesh.position.x -= step;
            } else {
                if (mesh.position.x < 8) mesh.position.x += step;
            }

            mesh.rotation.y = isLeft ? -Math.PI / 2 : Math.PI / 2;
            animatePerson(mesh, 'running');

            mesh.userData.mats.forEach(mat => {
                if (mat.color.getHex() !== 0x00ff00) {
                    mat.color.setHex(0x00ff00);
                    if (mat.emissive) mat.emissive.setHex(0x00ff00);
                }
            });
        });
        return;
    }

    // Verificar colapso del edificio
    if (bModel.isCollapsed) {
        let failedLevel = 0;
        let maxD = 0;
        for (let i = 0; i < N; i++) {
            if (bModel.D_max[i] > maxD) {
                maxD = bModel.D_max[i];
                failedLevel = i;
            }
        }
        if (evacState.currentFloor > failedLevel) {
            evacState.trapped = true;
            return;
        }
    }

    let startThreshold = (mode === "during") ? 10.0 : 30.0;

    if (currentTime < startThreshold) {
        evacState.currentFloor = N;
        const floorIdx = N - 1;
        if (floorIdx >= 0 && floorIdx < b3D.floors.length) {
            const floorMesh = b3D.floors[floorIdx];
            evacState.meshes.forEach((mesh, i) => {
                mesh.position.x = floorMesh.position.x + (i < 2 ? -0.5 : 0.5);
                mesh.position.z = floorMesh.position.z + (i % 2 === 0 ? -0.5 : 0.5);
                mesh.position.y = floorMesh.position.y + 0.1;

                mesh.rotation.y = 0;
                animatePerson(mesh, 'idle');
            });
        }
    } else {
        const elapsed = currentTime - startThreshold;
        const fractionalFloorsDown = elapsed / 8.0;
        const currentFloorFloat = N - fractionalFloorsDown;

        if (currentFloorFloat <= 0) {
            evacState.escaped = true;
            evacState.currentFloor = 0;
        } else {
            // Piso entero actual para mostrar en las métricas
            evacState.currentFloor = Math.ceil(currentFloorFloat);

            const floorIdxLower = Math.floor(currentFloorFloat); // piso de abajo (0 a N)
            const floorIdxUpper = Math.ceil(currentFloorFloat);  // piso de arriba (1 a N)

            const frac = currentFloorFloat - floorIdxLower; // Fracción decimal (0 a 1)

            let xPosLower = 0, yPosLower = 0, zPosLower = 0;
            if (floorIdxLower > 0 && floorIdxLower <= b3D.floors.length) {
                const lowerMesh = b3D.floors[floorIdxLower - 1];
                xPosLower = lowerMesh.position.x;
                yPosLower = lowerMesh.position.y;
                zPosLower = lowerMesh.position.z;
            }

            let xPosUpper = 0, yPosUpper = 0, zPosUpper = 0;
            if (floorIdxUpper > 0 && floorIdxUpper <= b3D.floors.length) {
                const upperMesh = b3D.floors[floorIdxUpper - 1];
                xPosUpper = upperMesh.position.x;
                yPosUpper = upperMesh.position.y;
                zPosUpper = upperMesh.position.z;
            }

            // Interpolación lineal
            const xPos = xPosLower * (1 - frac) + xPosUpper * frac;
            const yPos = yPosLower * (1 - frac) + yPosUpper * frac + 0.1;
            const zPos = zPosLower * (1 - frac) + zPosUpper * frac;

            evacState.meshes.forEach((mesh, i) => {
                mesh.position.x = xPos + (i < 2 ? -0.5 : 0.5);
                mesh.position.z = zPos + (i % 2 === 0 ? -0.5 : 0.5);
                mesh.position.y = yPos;

                mesh.rotation.y = isLeft ? Math.PI / 4 : -Math.PI / 4;
                animatePerson(mesh, 'running');

                const cycle = Math.floor(currentTime * 4) % 2;
                const evacColor = cycle === 0 ? 0xffaa00 : 0xffff00;
                mesh.userData.mats[0].color.setHex(evacColor);
                if (mesh.userData.mats[0].emissive) mesh.userData.mats[0].emissive.setHex(evacColor);
            });
        }
    }
}

function initParticles() {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particlesCount * 3);
    const colors = new Float32Array(particlesCount * 3);

    for (let i = 0; i < particlesCount; i++) {
        // Inicializar fuera de escena
        positions[i * 3] = 0;
        positions[i * 3 + 1] = -100;
        positions[i * 3 + 2] = 0;

        colors[i * 3] = 0.6;
        colors[i * 3 + 1] = 0.6;
        colors[i * 3 + 2] = 0.6;

        particlesData.push({
            velocity: new THREE.Vector3(0, 0, 0),
            life: 0,
            maxLife: 0,
            size: 0.1
        });
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
        size: 0.25,
        vertexColors: true,
        transparent: true,
        opacity: 0.6,
        blending: THREE.NormalBlending
    });

    particleSystem = new THREE.Points(geometry, material);
    scene.add(particleSystem);
}

function spawnParticles(x, y, z, count = 10) {
    const positions = particleSystem.geometry.attributes.position.array;
    let spawned = 0;

    for (let i = 0; i < particlesCount; i++) {
        if (particlesData[i].life <= 0) {
            positions[i * 3] = x + (Math.random() - 0.5) * 3;
            positions[i * 3 + 1] = y + (Math.random() - 0.5) * 0.5;
            positions[i * 3 + 2] = z + (Math.random() - 0.5) * 3;

            particlesData[i].velocity.set(
                (Math.random() - 0.5) * 1.5,
                Math.random() * 1.0 + 0.5,
                (Math.random() - 0.5) * 1.5
            );
            particlesData[i].maxLife = Math.random() * 40 + 20; // 0.2 a 0.6s
            particlesData[i].life = particlesData[i].maxLife;

            spawned++;
            if (spawned >= count) break;
        }
    }
    particleSystem.geometry.attributes.position.needsUpdate = true;
}

function updateParticles() {
    const positions = particleSystem.geometry.attributes.position.array;

    for (let i = 0; i < particlesCount; i++) {
        if (particlesData[i].life > 0) {
            // Aplicar velocidad
            positions[i * 3] += particlesData[i].velocity.x * 0.016;
            positions[i * 3 + 1] += particlesData[i].velocity.y * 0.016;
            positions[i * 3 + 2] += particlesData[i].velocity.z * 0.016;

            // Desaceleración y gravedad leve
            particlesData[i].velocity.y -= 0.1 * 0.016;
            particlesData[i].velocity.x *= 0.98;
            particlesData[i].velocity.z *= 0.98;

            particlesData[i].life -= 1;

            if (particlesData[i].life <= 0) {
                positions[i * 3 + 1] = -100; // mover abajo
            }
        }
    }
    particleSystem.geometry.attributes.position.needsUpdate = true;
}

// Helper para crear etiquetas de texto 3D autogiratorias (Sprites)
function createTextSprite(text, colorStr) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0, 0, 0, 0)';
    ctx.fillRect(0, 0, 128, 64);

    // Configurar tipografía y contorno para legibilidad
    ctx.font = 'Bold 32px sans-serif';
    ctx.fillStyle = colorStr;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.lineWidth = 4;
    ctx.strokeText(text, 64, 32);
    ctx.fillText(text, 64, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(1.2, 0.6, 1);
    return sprite;
}

// Actualizar posiciones de CM, CR y la flecha de excentricidad torsional
function updateBuildingCmCr(bData, bW, bD, activeDir) {
    if (!bData.cmCrGroup) return;

    const eccVal = parseFloat(document.getElementById("torsional-eccentricity").value) || 0.0;
    const isX = (activeDir === 'X');

    // Determinar la dirección y magnitud de la excentricidad
    // Si el sismo es en X, el desplazamiento del CM relativo al CR se da en el eje perpendicular (Z)
    // Si el sismo es en Y (Z horizontal en 3D), la excentricidad se da en el eje X
    let offsetX = 0;
    let offsetZ = 0;
    if (isX) {
        offsetZ = eccVal * bD;
    } else {
        offsetX = eccVal * bW;
    }

    // Actualizar posición de la esfera de CM y su etiqueta
    if (bData.cmMesh) {
        bData.cmMesh.position.set(offsetX, 0.12, offsetZ);
    }
    if (bData.cmLabel) {
        bData.cmLabel.position.set(offsetX, 0.38, offsetZ);
    }

    // Remover flecha anterior
    if (bData.eccArrow) {
        bData.cmCrGroup.remove(bData.eccArrow);
        bData.eccArrow = null;
    }

    // Dibujar la nueva flecha si hay excentricidad
    if (eccVal > 0) {
        const origin = new THREE.Vector3(0, 0.12, 0);
        const target = new THREE.Vector3(offsetX, 0.12, offsetZ);
        const dir = new THREE.Vector3().subVectors(target, origin);
        const length = dir.length();
        dir.normalize();

        const headLength = Math.min(0.4, length * 0.4);
        const headWidth = Math.min(0.2, length * 0.2);

        const arrow = new THREE.ArrowHelper(
            dir,
            origin,
            length,
            0xfacc15, // Amarillo brillante
            headLength,
            headWidth
        );
        bData.cmCrGroup.add(arrow);
        bData.eccArrow = arrow;
    }
}

// RECONSTRUCCIÓN DE LOS MODELOS 3D DE CADA EDIFICIO
function rebuild3DStructures() {
    // Limpiar escena anterior de edificios
    if (buildings3D.b2001.group) scene.remove(buildings3D.b2001.group);
    if (buildings3D.b2019.group) scene.remove(buildings3D.b2019.group);

    const N = eq2001.N;
    const h = eq2001.h;

    // Crear grupos
    buildings3D.b2001.group = new THREE.Group();
    buildings3D.b2019.group = new THREE.Group();

    // Dimensiones en planta de los edificios dinámicas según la distancia y número de columnas
    const numColsX = parseInt(document.getElementById("num-cols-x").value) || 2;
    const numColsY = parseInt(document.getElementById("num-cols-y").value) || 2;
    const sX = parseFloat(document.getElementById("col-dist-x").value) || 5.0;
    const sY = parseFloat(document.getElementById("col-dist-y").value) || 5.0;
    const bW = sX * (numColsX - 1);
    const bD = sY * (numColsY - 1);

    const xOffset = Math.max(6, bW / 2 + 3.5);

    // Posicionar edificios side-by-side de forma dinámica para evitar solapamientos
    buildings3D.b2001.group.position.set(-xOffset, 0, 0);
    buildings3D.b2019.group.position.set(xOffset, 0, 0);

    scene.add(buildings3D.b2001.group);
    scene.add(buildings3D.b2019.group);

    // Actualizar groundPlane geometry y gridHelper dinámicamente según la separación y dimensiones de los edificios
    if (groundPlane) {
        scene.remove(groundPlane);
        const groundW = Math.max(30, xOffset * 2 + bW + 8);
        const groundD = Math.max(12, bD + 6);
        const groundGeometry = new THREE.BoxGeometry(groundW, 0.5, groundD);
        const groundMaterial = new THREE.MeshStandardMaterial({
            color: 0x1a2130,
            roughness: 0.8,
            metalness: 0.1
        });
        groundPlane = new THREE.Mesh(groundGeometry, groundMaterial);
        groundPlane.position.y = -0.25;
        groundPlane.receiveShadow = true;
        scene.add(groundPlane);
    }

    if (gridHelper) {
        scene.remove(gridHelper);
        const gridGridSize = Math.max(40, xOffset * 2 + bW + 20);
        gridHelper = new THREE.GridHelper(gridGridSize, 20, 0x475569, 0x1e293b);
        gridHelper.position.y = 0.01;
        scene.add(gridHelper);
    }

    // Reconstruir indicadores de ejes con posición adaptada
    createAxisIndicators();

    // Función auxiliar para construir losas y columnas
    const buildBuilding = (bData, colorTheme) => {
        bData.floors = [];
        bData.columns = [];

        // Losa base (cimentación)
        const baseGeom = new THREE.BoxGeometry(bW + 0.6, 0.25, bD + 0.6);
        const baseMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.7 });
        const baseMesh = new THREE.Mesh(baseGeom, baseMat);
        baseMesh.position.y = 0.125;
        baseMesh.castShadow = true;
        baseMesh.receiveShadow = true;
        bData.group.add(baseMesh);

        // Crear losas para cada piso
        for (let i = 0; i < N; i++) {
            const floorGeom = new THREE.BoxGeometry(bW + 0.4, 0.2, bD + 0.4);
            const floorMat = new THREE.MeshStandardMaterial({
                color: colorTheme === '2001' ? 0x1e293b : 0x0f172a,
                roughness: 0.5,
                metalness: 0.2
            });
            const floorMesh = new THREE.Mesh(floorGeom, floorMat);
            floorMesh.position.set(0, (i + 1) * h, 0);
            floorMesh.castShadow = true;
            floorMesh.receiveShadow = true;
            bData.group.add(floorMesh);
            bData.floors.push(floorMesh);
        }

        // Grupo de visualización de CM y CR en la losa de techo (nivel N-1)
        const roofFloor = bData.floors[N - 1];
        const cmCrGroup = new THREE.Group();
        roofFloor.add(cmCrGroup);
        bData.cmCrGroup = cmCrGroup;

        // Comprobar estado inicial del checkbox
        const showCmCrCheck = document.getElementById("show-cm-cr");
        cmCrGroup.visible = showCmCrCheck ? showCmCrCheck.checked : true;

        // CR (Centro de Rigidez): Esfera Roja
        const sphereGeom = new THREE.SphereGeometry(0.12, 16, 16);
        const crMat = new THREE.MeshStandardMaterial({
            color: 0xef4444,
            emissive: 0x450a0a,
            roughness: 0.2,
            metalness: 0.8
        });
        const crMesh = new THREE.Mesh(sphereGeom, crMat);
        crMesh.position.set(0, 0.12, 0);
        cmCrGroup.add(crMesh);
        bData.crMesh = crMesh;

        // Etiqueta CR
        const crLabel = createTextSprite("CR", "#ef4444");
        crLabel.position.set(0, 0.38, 0);
        cmCrGroup.add(crLabel);

        // CM (Centro de Masas): Esfera Verde
        const cmMat = new THREE.MeshStandardMaterial({
            color: 0x22c55e,
            emissive: 0x052e16,
            roughness: 0.2,
            metalness: 0.8
        });
        const cmMesh = new THREE.Mesh(sphereGeom, cmMat);
        cmMesh.position.set(0, 0.12, 0);
        cmCrGroup.add(cmMesh);
        bData.cmMesh = cmMesh;

        // Etiqueta CM
        const cmLabel = createTextSprite("CM", "#22c55e");
        cmLabel.position.set(0, 0.38, 0);
        cmCrGroup.add(cmLabel);
        bData.cmLabel = cmLabel;

        // Flecha / Vector de excentricidad
        bData.eccArrow = null;

        // Crear columnas de entrepiso dinámicas
        const colOffsets = [];
        for (let ix = 0; ix < numColsX; ix++) {
            const x = numColsX > 1 ? -bW / 2 + (ix / (numColsX - 1)) * bW : 0;
            for (let iy = 0; iy < numColsY; iy++) {
                const z = numColsY > 1 ? -bD / 2 + (iy / (numColsY - 1)) * bD : 0;
                colOffsets.push({ x: x, z: z, ix: ix, iy: iy });
            }
        }
        const totalColsPerStory = colOffsets.length;

        // Leer valores de sección para Three.js
        const customSectionsCheck = document.getElementById("custom-sections-enable");
        const useCustom = customSectionsCheck ? customSectionsCheck.checked : false;

        let colW, colD, beamW, beamH;
        if (useCustom) {
            colW = (parseFloat(document.getElementById("col-width").value) || 35) / 100;
            colD = (parseFloat(document.getElementById("col-depth").value) || 35) / 100;
            beamW = (parseFloat(document.getElementById("beam-width").value) || 30) / 100;
            beamH = (parseFloat(document.getElementById("beam-depth").value) || 45) / 100;
        } else {
            colW = colorTheme === '2019' ? 0.35 : 0.28;
            colD = colW;
            beamW = colorTheme === '2019' ? 0.30 : 0.25;
            beamH = colorTheme === '2019' ? 0.45 : 0.35;
        }

        const flexureCheck = document.getElementById("show-flexure-deformation");
        const useFlexure = flexureCheck ? flexureCheck.checked : false;

        // Columnas
        for (let lvl = 0; lvl < N; lvl++) {
            const storyCols = [];
            for (let c = 0; c < totalColsPerStory; c++) {
                const numSegs = useFlexure ? 5 : 1;
                const hSeg = h / numSegs;
                const segGeom = new THREE.BoxGeometry(colW, hSeg, colD);

                // Material inicial seguro (Verde) único para esta columna (compartido por sus segmentos)
                const colMat = new THREE.MeshStandardMaterial({
                    color: varToHexColor('--color-safe'),
                    roughness: 0.4
                });

                const segments = [];
                for (let s = 0; s < numSegs; s++) {
                    const segMesh = new THREE.Mesh(segGeom, colMat);
                    segMesh.castShadow = true;
                    segMesh.receiveShadow = true;
                    // Posicionar a la altura correspondiente del segmento inicialmente
                    const xi = (s + 0.5) / numSegs;
                    segMesh.position.set(colOffsets[c].x, lvl * h + xi * h, colOffsets[c].z);
                    bData.group.add(segMesh);
                    segments.push(segMesh);
                }

                // Crear anillos de rótulas plásticas (Torus) en los extremos
                const torusRadius = Math.sqrt(colW * colW + colD * colD) / 2 + 0.015;
                const torusTube = 0.025;
                const ringGeom = new THREE.TorusGeometry(torusRadius, torusTube, 8, 24);

                const dummyMat = new THREE.MeshStandardMaterial({ visible: false });

                const bottomHinge = new THREE.Mesh(ringGeom, dummyMat);
                bottomHinge.position.set(0, -hSeg / 2 + 0.08, 0);
                bottomHinge.rotation.x = Math.PI / 2;
                segments[0].add(bottomHinge);

                const topHinge = new THREE.Mesh(ringGeom, dummyMat);
                topHinge.position.set(0, hSeg / 2 - 0.08, 0);
                topHinge.rotation.x = Math.PI / 2;
                segments[numSegs - 1].add(topHinge);

                storyCols.push({
                    meshes: segments,
                    material: colMat,
                    offsetX: colOffsets[c].x,
                    offsetZ: colOffsets[c].z,
                    level: lvl,
                    ix: colOffsets[c].ix,
                    iy: colOffsets[c].iy,
                    maxDriftRatio: 0,
                    bottomHinge: bottomHinge,
                    topHinge: topHinge
                });
            }
            bData.columns.push(storyCols);
        }

        bData.beamsX = [];
        bData.beamsY = [];

        // Crear vigas longitudinales (eje X)
        if (numColsX > 1) {
            const numSegs = useFlexure ? 5 : 1;
            const Lseg = sX / numSegs;
            const beamGeomX = new THREE.BoxGeometry(Lseg, beamH, beamW); // longitud, peralte, ancho
            const beamMat = new THREE.MeshStandardMaterial({
                color: colorTheme === '2001' ? 0x273549 : 0x182030,
                roughness: 0.6
            });

            for (let lvl = 0; lvl < N; lvl++) {
                const storyBeams = [];
                const floorMesh = bData.floors[lvl];
                for (let iy = 0; iy < numColsY; iy++) {
                    const z = numColsY > 1 ? -bD / 2 + (iy / (numColsY - 1)) * bD : 0;
                    for (let ix = 0; ix < numColsX - 1; ix++) {
                        const xStart = -bW / 2 + (ix / (numColsX - 1)) * bW;

                        const segments = [];
                        for (let s = 0; s < numSegs; s++) {
                            const segMesh = new THREE.Mesh(beamGeomX, beamMat);
                            segMesh.castShadow = true;
                            segMesh.receiveShadow = true;

                            // Posición local inicial
                            const eta = (s + 0.5) / numSegs;
                            const x_s = xStart + eta * sX;
                            segMesh.position.set(x_s, -0.1 - beamH / 2, z);
                            floorMesh.add(segMesh);
                            segments.push(segMesh);
                        }

                        storyBeams.push({
                            meshes: segments,
                            ix: ix,
                            iy: iy,
                            level: lvl,
                            span: sX,
                            xStart: xStart,
                            z: z
                        });
                    }
                }
                bData.beamsX.push(storyBeams);
            }
        }

        // Crear vigas transversales (eje Y)
        if (numColsY > 1) {
            const numSegs = useFlexure ? 5 : 1;
            const Lseg = sY / numSegs;
            const beamGeomY = new THREE.BoxGeometry(beamW, beamH, Lseg); // ancho, peralte, longitud
            const beamMat = new THREE.MeshStandardMaterial({
                color: colorTheme === '2001' ? 0x273549 : 0x182030,
                roughness: 0.6
            });

            for (let lvl = 0; lvl < N; lvl++) {
                const storyBeams = [];
                const floorMesh = bData.floors[lvl];
                for (let ix = 0; ix < numColsX; ix++) {
                    const x = numColsX > 1 ? -bW / 2 + (ix / (numColsX - 1)) * bW : 0;
                    for (let iy = 0; iy < numColsY - 1; iy++) {
                        const zStart = -bD / 2 + (iy / (numColsY - 1)) * bD;

                        const segments = [];
                        for (let s = 0; s < numSegs; s++) {
                            const segMesh = new THREE.Mesh(beamGeomY, beamMat);
                            segMesh.castShadow = true;
                            segMesh.receiveShadow = true;

                            // Posición local inicial
                            const eta = (s + 0.5) / numSegs;
                            const z_s = zStart + eta * sY;
                            segMesh.position.set(x, -0.1 - beamH / 2, z_s);
                            floorMesh.add(segMesh);
                            segments.push(segMesh);
                        }

                        storyBeams.push({
                            meshes: segments,
                            ix: ix,
                            iy: iy,
                            level: lvl,
                            span: sY,
                            zStart: zStart,
                            x: x
                        });
                    }
                }
                bData.beamsY.push(storyBeams);
            }
        }
    };

    buildBuilding(buildings3D.b2001, '2001');
    buildBuilding(buildings3D.b2019, '2019');

    const activeDir = document.getElementById("sismo1-direction").value;
    updateBuildingCmCr(buildings3D.b2001, bW, bD, activeDir);
    updateBuildingCmCr(buildings3D.b2019, bW, bD, activeDir);

    // Inicializar estados de evacuación
    const evacMeshes2001 = createEvacuationGroup(buildings3D.b2001, N, h, bW, bD);
    evacuation2001 = {
        meshes: evacMeshes2001 || [],
        currentFloor: N,
        startTime: null,
        escaped: false,
        trapped: false
    };

    const evacMeshes2019 = createEvacuationGroup(buildings3D.b2019, N, h, bW, bD);
    evacuation2019 = {
        meshes: evacMeshes2019 || [],
        currentFloor: N,
        startTime: null,
        escaped: false,
        trapped: false
    };
}

// Convertir colores CSS a Hex para ThreeJS
function varToHexColor(varName) {
    const rootStyles = getComputedStyle(document.documentElement);
    const colorStr = rootStyles.getPropertyValue(varName).trim();
    if (colorStr.startsWith('#')) {
        return parseInt(colorStr.replace('#', '0x'));
    }
    return 0xffffff;
}

// ACTUALIZACIÓN DE LA GEOMETRÍA 3D POR SWAY SÍSMICO Y DAÑO
function update3DPhysics() {
    const hasSecond = document.getElementById("double-earthquake").checked;
    const sismo1Dir = document.getElementById("sismo1-direction").value;
    const sismo2Dir = document.getElementById("sismo2-direction").value;
    const activeTime = simStepIndex * dt;
    const activeDir = (hasSecond && (activeTime >= 40.0)) ? sismo2Dir : sismo1Dir;
    const isX = (activeDir === 'X');

    // Desplazamiento actual del terreno (vibración visual del suelo)
    const groundDisp = groundAccel[simStepIndex] * 0.8; // amplificar visualmente el sismo

    if (isX) {
        groundPlane.position.x = groundDisp;
        groundPlane.position.z = 0;
    } else {
        groundPlane.position.x = 0;
        groundPlane.position.z = groundDisp;
    }

    const numColsX = parseInt(document.getElementById("num-cols-x").value) || 2;
    const sX = parseFloat(document.getElementById("col-dist-x").value) || 5.0;
    const bW = sX * (numColsX - 1);
    const xOffset = Math.max(6, bW / 2 + 3.5);

    // Actualizar Edificio 2001
    updateBuilding3DPhysics(eq2001, buildings3D.b2001, -xOffset, groundDisp, activeDir);

    // Actualizar Edificio 2019
    updateBuilding3DPhysics(eq2019, buildings3D.b2019, xOffset, groundDisp, activeDir);

    // Actualizar Evacuación
    const evacN = eq2001.N;
    const evacH = eq2001.h;
    updateEvacuation(evacuation2001, eq2001, buildings3D.b2001, evacN, evacH, true);
    updateEvacuation(evacuation2019, eq2019, buildings3D.b2019, evacN, evacH, false);

    // Actualizar Flechas de Corte Basal
    const numColsY = parseInt(document.getElementById("num-cols-y").value) || 2;
    const sY = parseFloat(document.getElementById("col-dist-y").value) || 5.0;
    const bD = sY * (numColsY - 1);
    updateBaseShearArrows(isX, xOffset, bD, groundDisp);
}

function updateBuilding3DPhysics(bModel, b3D, initialX, groundDisp, activeDir) {
    const N = bModel.N;
    const h = bModel.h;
    const isX = (activeDir === 'X');

    const flexureCheck = document.getElementById("show-flexure-deformation");
    const useFlexure = flexureCheck ? flexureCheck.checked : false;

    // Calcular dimensiones en planta y actualizar CM/CR
    const numColsX = parseInt(document.getElementById("num-cols-x").value) || 2;
    const numColsY = parseInt(document.getElementById("num-cols-y").value) || 2;
    const sX = parseFloat(document.getElementById("col-dist-x").value) || 5.0;
    const sY = parseFloat(document.getElementById("col-dist-y").value) || 5.0;
    const bW = sX * (numColsX - 1);
    const bD = sY * (numColsY - 1);
    updateBuildingCmCr(b3D, bW, bD, activeDir);

    // Desplazamiento total en base es la vibración del suelo
    b3D.group.position.x = initialX + (isX ? groundDisp : 0);
    b3D.group.position.z = isX ? 0 : groundDisp;

    if (bModel.isCollapsed) {
        // Animación de colapso progresivo
        // Haremos que las losas caigan verticalmente con gravedad simulada
        const collapseSpeed = 0.08;

        // Encontrar primer piso fallado (donde daño es máximo)
        let failedLevel = 0;
        let maxD = 0;
        for (let i = 0; i < N; i++) {
            if (bModel.D_max[i] > maxD) {
                maxD = bModel.D_max[i];
                failedLevel = i;
            }
        }

        // Simular caída libre para todas las losas por encima del piso fallado
        for (let lvl = failedLevel; lvl < N; lvl++) {
            const floorMesh = b3D.floors[lvl];

            // Destino de caída es la losa inferior
            const targetY = (lvl === 0) ? 0.1 : b3D.floors[lvl - 1].position.y + 0.15;

            if (floorMesh.position.y > targetY) {
                floorMesh.position.y -= collapseSpeed;
                floorMesh.position.x += (Math.random() - 0.5) * 0.05; // vibración de escombros
                floorMesh.position.z += (Math.random() - 0.5) * 0.05;

                // Partículas de polvo en la caída
                if (Math.random() < 0.3) {
                    spawnParticles(
                        b3D.group.position.x + floorMesh.position.x,
                        floorMesh.position.y,
                        b3D.group.position.z + floorMesh.position.z,
                        5
                    );
                }
            }

            // Columnas del piso fallado colapsan (escala vertical va a cero y se rotan)
            const cols = b3D.columns[lvl];
            cols.forEach(col => {
                col.meshes.forEach(segMesh => {
                    segMesh.scale.y = Math.max(0.1, segMesh.scale.y - 0.05);
                    segMesh.rotation.z += (col.offsetX > 0 ? 0.03 : -0.03);
                });
                col.material.color.setHex(0x111111); // Negro de escombros quemados/destruidos

                // Ocultar rótulas plásticas en colapso
                if (col.bottomHinge) col.bottomHinge.visible = false;
                if (col.topHinge) col.topHinge.visible = false;
            });
        }
        return;
    }

    // Parámetros geométricos para torsión
    const ecc = parseFloat(document.getElementById("torsional-eccentricity").value) || 0.0;
    const rp = Math.sqrt((bW * bW + bD * bD) / 12) || 2.0;

    // Comportamiento normal (oscilación lateral + torsión)
    for (let lvl = 0; lvl < N; lvl++) {
        // Desplazamiento del nivel actual
        const d_curr = bModel.x[lvl] * 6.0; // amplificado para visibilidad en 3D
        const d_prev = (lvl === 0) ? 0 : bModel.x[lvl - 1] * 6.0;

        // Ángulo de rotación del nivel actual (amplificado para visibilidad)
        const theta_curr = (d_curr * ecc) / rp;
        const theta_prev = (lvl === 0) ? 0 : (d_prev * ecc) / rp;

        // Desplazar y rotar losa
        const floorMesh = b3D.floors[lvl];
        if (isX) {
            floorMesh.position.x = d_curr;
            floorMesh.position.z = 0;
        } else {
            floorMesh.position.x = 0;
            floorMesh.position.z = d_curr;
        }
        floorMesh.rotation.y = theta_curr;

        // Posicionar y deformar las columnas de este nivel
        const cols = b3D.columns[lvl];

        const x_trans_prev = isX ? d_prev : 0;
        const z_trans_prev = isX ? 0 : d_prev;
        const x_trans_curr = isX ? d_curr : 0;
        const z_trans_curr = isX ? 0 : d_curr;

        cols.forEach(col => {
            const ox = col.offsetX;
            const oz = col.offsetZ;

            // Posición inferior de la columna (rotada en planta lvl-1)
            const x_bottom = x_trans_prev + ox * Math.cos(theta_prev) - oz * Math.sin(theta_prev);
            const z_bottom = z_trans_prev + ox * Math.sin(theta_prev) + oz * Math.cos(theta_prev);

            // Posición superior de la columna (rotada en planta lvl)
            const x_top = x_trans_curr + ox * Math.cos(theta_curr) - oz * Math.sin(theta_curr);
            const z_top = z_trans_curr + ox * Math.sin(theta_curr) + oz * Math.cos(theta_curr);

            // Guardar posiciones para uso de las vigas
            col.x_bottom_curr = x_bottom;
            col.z_bottom_curr = z_bottom;
            col.x_top_curr = x_top;
            col.z_top_curr = z_top;

            // Calcular derivas reales (físicas, no amplificadas) de esta columna particular
            const theta_curr_phys = (bModel.x[lvl] * ecc) / rp;
            const theta_prev_phys = (lvl === 0) ? 0 : (bModel.x[lvl - 1] * ecc) / rp;

            const x_trans_p_phys = isX ? (lvl === 0 ? 0 : bModel.x[lvl - 1]) : 0;
            const z_trans_p_phys = isX ? 0 : (lvl === 0 ? 0 : bModel.x[lvl - 1]);
            const x_trans_c_phys = isX ? bModel.x[lvl] : 0;
            const z_trans_c_phys = isX ? 0 : bModel.x[lvl];

            const x_b_phys = x_trans_p_phys + ox * Math.cos(theta_prev_phys) - oz * Math.sin(theta_prev_phys);
            const z_b_phys = z_trans_p_phys + ox * Math.sin(theta_prev_phys) + oz * Math.cos(theta_prev_phys);

            const x_t_phys = x_trans_c_phys + ox * Math.cos(theta_curr_phys) - oz * Math.sin(theta_curr_phys);
            const z_t_phys = z_trans_c_phys + ox * Math.sin(theta_curr_phys) + oz * Math.cos(theta_curr_phys);

            const drift_x_phys = x_t_phys - x_b_phys;
            const drift_z_phys = z_t_phys - z_b_phys;
            const colDriftRatio = Math.sqrt(drift_x_phys * drift_x_phys + drift_z_phys * drift_z_phys) / h;
            col.maxDriftRatio = Math.max(col.maxDriftRatio || 0, colDriftRatio);

            // Determinar color de esta columna según su propia deriva
            let colColor;
            if (colDriftRatio < 0.015) {
                colColor = varToHexColor('--color-safe');
            } else if (colDriftRatio < 0.018) {
                colColor = varToHexColor('--color-warning');
                if (bModel.analysisMode === 'nonlinear' && Math.random() < 0.05) {
                    spawnParticles(b3D.group.position.x + (x_bottom + x_top) / 2, (lvl + 0.5) * h, b3D.group.position.z + (z_bottom + z_top) / 2, 1);
                }
            } else if (colDriftRatio < 0.030) {
                colColor = varToHexColor('--color-damage');
                if (bModel.analysisMode === 'nonlinear' && Math.random() < 0.15) {
                    spawnParticles(b3D.group.position.x + (x_bottom + x_top) / 2, (lvl + 0.5) * h, b3D.group.position.z + (z_bottom + z_top) / 2, 2);
                }
            } else {
                colColor = 0x222222; // fallo local de la columna
            }

            col.material.color.setHex(colColor);

            // Actualizar visualización de Rótulas Plásticas
            if (col.bottomHinge && col.topHinge) {
                if (colDriftRatio >= 0.018) {
                    col.bottomHinge.material = hingeRedMat;
                    col.topHinge.material = hingeRedMat;
                    col.bottomHinge.visible = true;
                    col.topHinge.visible = true;
                } else if (colDriftRatio >= 0.015) {
                    col.bottomHinge.material = hingeYellowMat;
                    col.topHinge.material = hingeYellowMat;
                    col.bottomHinge.visible = true;
                    col.topHinge.visible = true;
                } else {
                    col.bottomHinge.visible = false;
                    col.topHinge.visible = false;
                }
            }

            // Mover y deformar las columnas según la opción de flexión avanzada
            const dx = x_top - x_bottom;
            const dz = z_top - z_bottom;

            if (useFlexure) {
                const numSegs = col.meshes.length;
                col.meshes.forEach((segMesh, s) => {
                    const xi = (s + 0.5) / numSegs;
                    // Curva cúbica de flexión (doble curvatura)
                    const f_xi = 3 * xi * xi - 2 * xi * xi * xi;
                    // Derivada (pendiente)
                    const slope_xi = 6 * xi * (1 - xi);

                    const x_s = x_bottom + dx * f_xi;
                    const z_s = z_bottom + dz * f_xi;
                    const y_s = lvl * h + xi * h;

                    segMesh.position.set(x_s, y_s, z_s);

                    // Pendientes en X y Z
                    const dx_dy = (dx / h) * slope_xi;
                    const dz_dy = (dz / h) * slope_xi;

                    segMesh.rotation.z = -Math.atan(dx_dy);
                    segMesh.rotation.x = Math.atan(dz_dy);
                    segMesh.rotation.y = theta_prev + (theta_curr - theta_prev) * xi;
                });
            } else {
                // Comportamiento rígido clásico (muy rápido, 1 segmento)
                const segMesh = col.meshes[0];
                if (segMesh) {
                    segMesh.position.set(
                        (x_bottom + x_top) / 2,
                        (lvl + 0.5) * h,
                        (z_bottom + z_top) / 2
                    );
                    segMesh.rotation.z = -Math.atan2(dx, h);
                    segMesh.rotation.x = Math.atan2(dz, h);
                    segMesh.rotation.y = (theta_prev + theta_curr) / 2;
                }
            }
        });

        // Configuración de vigas
        const colorTheme = (bModel === eq2001) ? '2001' : '2019';
        const customSectionsCheck = document.getElementById("custom-sections-enable");
        const useCustom = customSectionsCheck ? customSectionsCheck.checked : false;
        let beamH;
        if (useCustom) {
            beamH = (parseFloat(document.getElementById("beam-depth").value) || 45) / 100;
        } else {
            beamH = (colorTheme === '2019') ? 0.45 : 0.35;
        }

        // Actualizar vigas en X (longitudinales)
        if (b3D.beamsX && b3D.beamsX[lvl]) {
            const beams = b3D.beamsX[lvl];
            beams.forEach(beam => {
                const L = beam.span;
                if (useFlexure) {
                    const colA = cols[beam.ix * numColsY + beam.iy];
                    const colB = cols[(beam.ix + 1) * numColsY + beam.iy];

                    const dxA = colA.x_top_curr - colA.x_bottom_curr;
                    const dxB = colB.x_top_curr - colB.x_bottom_curr;

                    const phiA = dxA / h;
                    const phiB = dxB / h;

                    beam.meshes.forEach((segMesh, s) => {
                        const eta = (s + 0.5) / 5;
                        const x_s = beam.xStart + eta * L;
                        // Deflexión de Hermite local
                        const y_s = -0.1 - beamH / 2 + L * (phiA * eta * Math.pow(1 - eta, 2) - phiB * Math.pow(eta, 2) * (1 - eta));
                        // Pendiente local
                        const slope = phiA * (1 - 4 * eta + 3 * eta * eta) - phiB * (2 * eta - 3 * eta * eta);

                        segMesh.position.set(x_s, y_s, beam.z);
                        segMesh.rotation.z = Math.atan(slope);
                        segMesh.rotation.x = 0;
                        segMesh.rotation.y = 0;
                    });
                } else {
                    const segMesh = beam.meshes[0];
                    if (segMesh) {
                        const xCenter = beam.xStart + L / 2;
                        segMesh.position.set(xCenter, -0.1 - beamH / 2, beam.z);
                        segMesh.rotation.set(0, 0, 0);
                    }
                }
            });
        }

        // Actualizar vigas en Y (transversales)
        if (b3D.beamsY && b3D.beamsY[lvl]) {
            const beams = b3D.beamsY[lvl];
            beams.forEach(beam => {
                const L = beam.span;
                if (useFlexure) {
                    const colA = cols[beam.ix * numColsY + beam.iy];
                    const colB = cols[beam.ix * numColsY + (beam.iy + 1)];

                    const dzA = colA.z_top_curr - colA.z_bottom_curr;
                    const dzB = colB.z_top_curr - colB.z_bottom_curr;

                    const phiA = dzA / h;
                    const phiB = dzB / h;

                    beam.meshes.forEach((segMesh, s) => {
                        const eta = (s + 0.5) / 5;
                        const z_s = beam.zStart + eta * L;
                        // Deflexión de Hermite local
                        const y_s = -0.1 - beamH / 2 + L * (phiA * eta * Math.pow(1 - eta, 2) - phiB * Math.pow(eta, 2) * (1 - eta));
                        // Pendiente local
                        const slope = phiA * (1 - 4 * eta + 3 * eta * eta) - phiB * (2 * eta - 3 * eta * eta);

                        segMesh.position.set(beam.x, y_s, z_s);
                        segMesh.rotation.x = -Math.atan(slope);
                        segMesh.rotation.z = 0;
                        segMesh.rotation.y = 0;
                    });
                } else {
                    const segMesh = beam.meshes[0];
                    if (segMesh) {
                        const zCenter = beam.zStart + L / 2;
                        segMesh.position.set(beam.x, -0.1 - beamH / 2, zCenter);
                        segMesh.rotation.set(0, 0, 0);
                    }
                }
            });
        }
    }
}

// Bucle de renderizado de Three.js
function animate3D() {
    requestAnimationFrame(animate3D);

    // Controles orbitales
    controls.update();

    // Actualizar partículas
    updateParticles();

    // Renderizado
    renderer.render(scene, camera);
}

// --- BUCLE DE SIMULACIÓN Y CONTROL DEL TIEMPO ---
function toggleSimulation() {
    const btnRun = document.getElementById("btn-run");
    const btnPause = document.getElementById("btn-pause");
    const mobRun = document.getElementById("mobile-btn-run");
    const mobPause = document.getElementById("mobile-btn-pause");
    const mobReset = document.getElementById("mobile-btn-reset");

    if (!isPlaying) {
        // INICIAR
        isPlaying = true;
        isPaused = false;

        btnRun.innerHTML = '<i class="fa-solid fa-stop"></i> Detener';
        btnRun.classList.replace("btn-primary", "btn-danger");
        btnPause.disabled = false;
        document.getElementById("btn-reset").disabled = true;

        if (mobRun) {
            mobRun.innerHTML = '<i class="fa-solid fa-stop"></i>';
            mobRun.classList.replace("btn-primary", "btn-danger");
        }
        if (mobPause) mobPause.disabled = false;
        if (mobReset) mobReset.disabled = true;

        // Bloquear controles de configuración
        toggleInputControls(true);

        // Iniciar loop
        simStepIndex = 0;
        currentTime = 0;

        simInterval = setInterval(simulationLoop, 10); // 10ms por paso (100 fps de física)
    } else {
        // DETENER
        stopSimulation();
    }
}

function stopSimulation() {
    isPlaying = false;
    isPaused = false;
    clearInterval(simInterval);

    const btnRun = document.getElementById("btn-run");
    btnRun.innerHTML = '<i class="fa-solid fa-play"></i> Iniciar Simulación';
    btnRun.classList.replace("btn-danger", "btn-primary");

    document.getElementById("btn-pause").disabled = true;
    document.getElementById("btn-pause").innerHTML = '<i class="fa-solid fa-pause"></i> Pausar';
    document.getElementById("btn-reset").disabled = false;

    // Sincronizar botones móviles
    const mobRun = document.getElementById("mobile-btn-run");
    if (mobRun) {
        mobRun.innerHTML = '<i class="fa-solid fa-play"></i>';
        mobRun.classList.replace("btn-danger", "btn-primary");
    }
    const mobPause = document.getElementById("mobile-btn-pause");
    if (mobPause) {
        mobPause.disabled = true;
        mobPause.innerHTML = '<i class="fa-solid fa-pause"></i>';
    }
    const mobReset = document.getElementById("mobile-btn-reset");
    if (mobReset) mobReset.disabled = false;

    toggleInputControls(false);
    updateCalculationReport();
}

function pauseSimulation() {
    const btnPause = document.getElementById("btn-pause");
    const mobPause = document.getElementById("mobile-btn-pause");
    if (!isPaused) {
        // PAUSAR
        isPaused = true;
        clearInterval(simInterval);
        btnPause.innerHTML = '<i class="fa-solid fa-play"></i> Reanudar';
        if (mobPause) mobPause.innerHTML = '<i class="fa-solid fa-play"></i>';
        updateCalculationReport();
    } else {
        // REANUDAR
        isPaused = false;
        btnPause.innerHTML = '<i class="fa-solid fa-pause"></i> Pausar';
        if (mobPause) mobPause.innerHTML = '<i class="fa-solid fa-pause"></i>';
        simInterval = setInterval(simulationLoop, 10);
    }
}

function resetSimulation() {
    stopSimulation();
    generateSpectraAndEarthquake();
    currentTime = 0;
    document.getElementById("metric-time").innerHTML = `0.00 <span class="unit">s</span>`;
    document.getElementById("metric-phase").textContent = "En reposo";
    document.getElementById("metric-phase").className = "text-green";

    // Resetear textos de métricas
    document.getElementById("drift-2001").textContent = "0.00%";
    document.getElementById("drift-2019").textContent = "0.00%";
    document.getElementById("damage-2001").textContent = "0.00%";
    document.getElementById("damage-2019").textContent = "0.00%";

    const status1 = document.getElementById("status-2001");
    status1.textContent = "Estable";
    status1.className = "metric-status";

    const status2 = document.getElementById("status-2019");
    status2.textContent = "Estable";
    status2.className = "metric-status";

    const evac1 = document.getElementById("evac-2001");
    if (evac1) evac1.innerHTML = getEvacStatusText(evacuation2001);
    const evac2 = document.getElementById("evac-2019");
    if (evac2) evac2.innerHTML = getEvacStatusText(evacuation2019);
}

function toggleInputControls(disable) {
    const inputs = [
        "num-stories", "num-cols-x", "num-cols-y", "col-dist-x", "col-dist-y", "story-height", "story-mass", "damping-ratio",
        "torsional-eccentricity",
        "covenin01-zone", "covenin01-soil", "covenin01-r", "covenin01-importance",
        "covenin19-soil-class", "covenin19-a0", "covenin19-a1", "covenin19-r",
        "covenin19-rho", "covenin19-fi", "analysis-mode", "degradation-severity",
        "double-earthquake", "custom-sections-enable", "col-width", "col-depth",
        "beam-width", "beam-depth",
        "concrete-fc-col", "concrete-fc-beam", "steel-fy-col", "steel-fy-beam",
        "col-as", "beam-as", "beam-as-prime",
        "sismo1-direction", "sismo2-direction",
        "auto-mass", "building-use", "slab-thickness", "extra-dead-load",
        "evacuation-mode"
    ];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = disable;
    });
}

// BUCLE DE FÍSICA PRINCIPAL
function simulationLoop() {
    if (simStepIndex >= groundAccel.length) {
        // Fin de la simulación
        stopSimulation();
        return;
    }

    currentTime = simStepIndex * dt;
    const a_g = groundAccel[simStepIndex];

    const hasSecond = document.getElementById("double-earthquake").checked;
    const sismo1Dir = document.getElementById("sismo1-direction").value;
    const sismo2Dir = document.getElementById("sismo2-direction").value;
    const activeDir = (hasSecond && (currentTime >= 40.0)) ? sismo2Dir : sismo1Dir;

    // Correr paso dinámico de los edificios
    eq2001.step(a_g, activeDir);
    eq2019.step(a_g, activeDir);

    // Actualizar visualizaciones y métricas
    update3DPhysics();
    updateChartsRealTime(simStepIndex);
    updateMetricsUI();

    simStepIndex++;
}

// ACTUALIZACIÓN DE LA TABLA DE ESTADOS Y MÉTRICAS
function getEvacStatusText(evacState) {
    const mode = document.getElementById("evacuation-mode").value;
    if (mode === "off") return `<span style="color: var(--text-muted);">Desactivada</span>`;

    if (evacState.trapped) {
        return `<span style="color: #ff4d4d; font-weight: bold;" class="animate-pulse"><i class="fa-solid fa-triangle-exclamation"></i> Atrapados (Piso ${evacState.currentFloor})</span>`;
    }
    if (evacState.escaped) {
        return `<span style="color: var(--color-safe); font-weight: bold;"><i class="fa-solid fa-circle-check"></i> A salvo</span>`;
    }

    let startThreshold = (mode === "during") ? 10.0 : 30.0;
    if (currentTime < startThreshold) {
        return `<span style="color: var(--text-muted);"><i class="fa-regular fa-clock"></i> Esperando (Piso ${evacState.currentFloor})</span>`;
    }

    return `<span style="color: #ffb703; font-weight: bold;" class="animate-pulse"><i class="fa-solid fa-person-running"></i> Piso ${evacState.currentFloor}</span>`;
}

function updateMetricsUI() {
    document.getElementById("metric-time").innerHTML = `${currentTime.toFixed(2)} <span class="unit">s</span>`;

    // Fase del sismo
    const phaseSpan = document.getElementById("metric-phase");
    const hasSecond = document.getElementById("double-earthquake").checked;

    if (currentTime < 2) {
        phaseSpan.textContent = "Iniciando Sismo 1 (M7.1)";
        phaseSpan.className = "text-yellow";
    } else if (currentTime >= 2 && currentTime < 15) {
        phaseSpan.textContent = "Fase Fuerte Sismo 1";
        phaseSpan.className = "text-red animate-pulse";
    } else if (currentTime >= 15 && currentTime < 30) {
        phaseSpan.textContent = "Decaimiento Sismo 1";
        phaseSpan.className = "text-yellow";
    } else if (currentTime >= 30 && currentTime < 40) {
        phaseSpan.textContent = hasSecond ? "Calma Temprana (Espera Sismo 2)" : "Fase Final";
        phaseSpan.className = "text-green";
    } else if (hasSecond && currentTime >= 40 && currentTime < 43) {
        phaseSpan.textContent = "¡SISMO 2 (M7.5) DETECTADO!";
        phaseSpan.className = "text-red animate-pulse font-bold";
    } else if (hasSecond && currentTime >= 43 && currentTime < 58) {
        phaseSpan.textContent = "Fase Fuerte Sismo 2";
        phaseSpan.className = "text-red animate-pulse";
    } else if (hasSecond && currentTime >= 58 && currentTime < 72) {
        phaseSpan.textContent = "Decaimiento Sismo 2";
        phaseSpan.className = "text-yellow";
    } else {
        phaseSpan.textContent = "Tranquilidad / Sismo Finalizado";
        phaseSpan.className = "text-green";
    }

    // Métricas del Edificio 2001
    const drift1 = (eq2001.maxDriftRatio * 100).toFixed(2) + "%";
    document.getElementById("drift-2001").textContent = drift1;

    const damage1 = (Math.max(...eq2001.D_max) * 100).toFixed(1) + "%";
    document.getElementById("damage-2001").textContent = damage1;

    const status1 = document.getElementById("status-2001");
    if (eq2001.isCollapsed) {
        status1.textContent = "¡COLAPSO!";
        status1.className = "metric-status status-collapsed";
    } else {
        const maxD = Math.max(...eq2001.D_max);
        if (maxD > 0.6) {
            status1.textContent = "Daño Crítico";
            status1.className = "metric-status status-danger";
        } else if (maxD > 0.2) {
            status1.textContent = "Daño Moderado";
            status1.className = "metric-status status-warning";
        } else {
            status1.textContent = "Estable";
            status1.className = "metric-status";
        }
    }

    const evac2001El = document.getElementById("evac-2001");
    if (evac2001El) evac2001El.innerHTML = getEvacStatusText(evacuation2001);

    // Métricas del Edificio 2019
    const drift2 = (eq2019.maxDriftRatio * 100).toFixed(2) + "%";
    document.getElementById("drift-2019").textContent = drift2;

    const damage2 = (Math.max(...eq2019.D_max) * 100).toFixed(1) + "%";
    document.getElementById("damage-2019").textContent = damage2;

    const status2 = document.getElementById("status-2019");
    if (eq2019.isCollapsed) {
        status2.textContent = "¡COLAPSO!";
        status2.className = "metric-status status-collapsed";
    } else {
        const maxD = Math.max(...eq2019.D_max);
        if (maxD > 0.6) {
            status2.textContent = "Daño Crítico";
            status2.className = "metric-status status-danger";
        } else if (maxD > 0.2) {
            status2.textContent = "Daño Moderado";
            status2.className = "metric-status status-warning";
        } else {
            status2.textContent = "Estable";
            status2.className = "metric-status";
        }
    }

    const evac2019El = document.getElementById("evac-2019");
    if (evac2019El) evac2019El.innerHTML = getEvacStatusText(evacuation2019);

    // Actualizar datos de la columna seleccionada
    updateSelectedColumnPanel();
}

// --- OBTENER SISMOS RECIENTES DE LA REGION DE VENEZUELA (USGS API) ---
function fetchRecentEarthquakes() {
    const listContainer = document.getElementById("sismos-list-container");
    const loadingStatus = document.getElementById("sismos-loading-status");
    if (!listContainer || !loadingStatus) return;

    listContainer.innerHTML = "";
    loadingStatus.style.display = "block";

    // 1000 km a la redonda del centro de Venezuela (Lat 8.0, Lon -66.0) para cubrir toda la red
    const url = "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&latitude=8.0&longitude=-66.0&maxradiuskm=1000&minmagnitude=2.5&orderby=time&limit=12";

    fetch(url)
        .then(res => {
            if (!res.ok) throw new Error("Error en la respuesta del servidor USGS");
            return res.json();
        })
        .then(data => {
            loadingStatus.style.display = "none";
            const features = data.features || [];

            if (features.length === 0) {
                listContainer.innerHTML = `
                    <div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 25px; background: rgba(30, 41, 59, 0.2); border-radius: 8px;">
                        No se registraron sismos de magnitud ≥ 2.5 en las últimas semanas para esta región.
                    </div>
                `;
                return;
            }

            features.forEach(feature => {
                const props = feature.properties;
                const geom = feature.geometry;
                const coords = geom.coordinates; // [longitude, latitude, depth]
                const mag = props.mag;
                const timeMs = props.time;
                const place = props.place;
                const urlDetail = props.url;

                // Formatear fecha local venezolana
                const dateObj = new Date(timeMs);
                const dateFormatted = dateObj.toLocaleDateString("es-VE", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric"
                });
                const timeFormatted = dateObj.toLocaleTimeString("es-VE", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit"
                });

                // Determinar clase de magnitud
                let magClass = "mag-low";
                if (mag >= 4.5) {
                    magClass = "mag-high";
                } else if (mag >= 3.5) {
                    magClass = "mag-medium";
                }

                // Traducir ligeramente algunas ubicaciones comunes en inglés
                let placeTranslated = place
                    .replace("Venezuela", "Venezuela")
                    .replace("offshore", "costa afuera de")
                    .replace("of", "de")
                    .replace("North", "Norte")
                    .replace("South", "Sur")
                    .replace("East", "Este")
                    .replace("West", "Oeste");

                const cardHtml = `
                    <div class="sismo-card">
                        <div>
                            <div class="sismo-header">
                                <span class="sismo-mag-badge ${magClass}">M ${mag.toFixed(1)}</span>
                                <span class="sismo-time">${dateFormatted} ${timeFormatted}</span>
                            </div>
                            <div class="sismo-body">
                                <div class="sismo-place">${placeTranslated}</div>
                                <div class="sismo-detail">
                                    <span>Latitud: ${coords[1].toFixed(3)}°</span>
                                    <span>Longitud: ${coords[0].toFixed(3)}°</span>
                                </div>
                                <div class="sismo-detail">
                                    <span>Profundidad: ${coords[2].toFixed(1)} km</span>
                                </div>
                            </div>
                        </div>
                        <div class="sismo-footer">
                            <a href="${urlDetail}" target="_blank" class="sismo-link">
                                Ver Detalles en USGS <i class="fa-solid fa-arrow-up-right-from-square"></i>
                            </a>
                        </div>
                    </div>
                `;
                listContainer.insertAdjacentHTML("beforeend", cardHtml);
            });
        })
        .catch(err => {
            console.error("[fetchRecentEarthquakes]", err);
            loadingStatus.style.display = "none";
            listContainer.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; color: var(--color-damage); padding: 30px; background: rgba(239, 68, 68, 0.05); border: 1px dashed var(--color-damage); border-radius: 8px;">
                    <i class="fa-solid fa-triangle-exclamation fa-2x" style="margin-bottom: 12px; color: var(--color-damage);"></i>
                    <p style="font-weight: 600;">No se pudo conectar con el catálogo de sismos del USGS.</p>
                    <p style="font-size: 11px; color: var(--text-muted); margin-top: 6px;">Por favor, verifique su conexión a Internet o intente de nuevo.</p>
                </div>
            `;
        });
}

function initVargasChart() {
    const ctx = document.getElementById('vargas-chart');
    if (!ctx) return;

    vargasChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['4 Pisos', '5 Pisos', '6 Pisos', '7 Pisos', '8 Pisos', '9 Pisos', '10 Pisos'],
            datasets: [
                {
                    label: 'COVENIN 1756:2001',
                    data: [9.1, 54.5, 54.5, 63.6, 63.6, 90.9, 100.0],
                    backgroundColor: 'rgba(0, 180, 216, 0.65)',
                    borderColor: '#00b4d8',
                    borderWidth: 1.5,
                    borderRadius: 4
                },
                {
                    label: 'COVENIN 1756:2019',
                    data: [0.0, 0.0, 0.0, 9.1, 18.2, 63.6, 81.8],
                    backgroundColor: 'rgba(255, 0, 127, 0.65)',
                    borderColor: '#ff007f',
                    borderWidth: 1.5,
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: '#94a3b8',
                        font: { family: 'Inter', size: 11 }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return ` ${context.dataset.label}: ${context.raw}% de colapsos`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: {
                        color: '#94a3b8',
                        font: { family: 'Inter', size: 11 }
                    }
                },
                y: {
                    min: 0,
                    max: 100,
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: {
                        color: '#94a3b8',
                        font: { family: 'Inter', size: 11 },
                        callback: function(value) {
                            return value + '%';
                        }
                    },
                    title: {
                        display: true,
                        text: 'Probabilidad de Colapso',
                        color: '#94a3b8',
                        font: { family: 'Inter', size: 11 }
                    }
                }
            }
        }
    });
}

// ============================================================
//  MAPA SATELITAL DE DAÑO SÍSMICO — LA GUAIRA / CARABALLEDA
// ============================================================

function initDamageMap() {
    const container = document.getElementById('damage-map-container');
    if (!container || typeof L === 'undefined') {
        console.warn('[initDamageMap] Leaflet or container not available');
        return;
    }

    // --- Collapse probability data from Monte Carlo simulations (Vargas 2026) ---
    // Key: number of floors → { p2001: %, p2019: % }
    const collapseData = {
        4:  { p2001: 100.0, p2019: 45.5 },
        5:  { p2001: 100.0, p2019: 63.6 },
        6:  { p2001: 100.0, p2019: 36.4 },
        7:  { p2001: 100.0, p2019: 72.7 },
        8:  { p2001:  90.9, p2019: 63.6 },
        9:  { p2001:  81.8, p2019: 63.6 },
        10: { p2001:  81.8, p2019: 54.5 }
    };

    // --- 198 real buildings geolocated across La Guaira / Vargas dataset ---
    // Extracted directly from terremotovenezuela.com database & post-seismic citizen reports
    const buildings = [
        {
                "id": "13b1edd2-bd7b-4e0d-b5ce-212427786425",
                "name": "Solymar",
                "zone": "Caraballeda",
                "address": "J56H+54G, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61044,
                "lng": -66.82217,
                "floors": 8,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/0afc4e1f-763e-4335-a86b-eab4940d7488.png",
                "real": true
        },
        {
                "id": "fd9ad90f-5ad6-492b-9e4a-c086ba6885e2",
                "name": "Edificio Punta Piedra",
                "zone": "Hotel Las Quince Letras",
                "address": "J437+PWV, Macuto 1164, La Guaira, Venezuela",
                "lat": 10.60436,
                "lng": -66.88521,
                "floors": 6,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/ee141332-9c40-40a1-bdbf-493005388747.jpg",
                "real": true
        },
        {
                "id": "fc3b56e5-0425-42b4-8499-74f42b6fcf51",
                "name": "RESIDENCIAS GRAÑAMAR",
                "zone": "Caribe",
                "address": "Av. Terepaima, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61126,
                "lng": -66.84329,
                "floors": 9,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/7d591f0d-1a7f-4d3d-a369-d8d01eea7b69.jpeg",
                "real": true
        },
        {
                "id": "fa85134a-59a7-45e7-b355-fbf578141268",
                "name": "Residencias Marena",
                "zone": "Simón Bolívar",
                "address": "Vía Catia La Mar, Maiquetía 1162, La Guaira, Venezuela",
                "lat": 10.61087,
                "lng": -67.01258,
                "floors": 8,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/cf5c2ff1-0631-4c4e-a561-b2eca7dba38f.jpg",
                "real": true
        },
        {
                "id": "f9be3f0d-8dc3-4b24-8cf0-ee704fbcec07",
                "name": "Edificio Cambural cerca de la panadería almendrina playa grande la guaira",
                "zone": "Playa Grande",
                "address": "Playa Grande, Maiquetía 1162, La Guaira, Venezuela",
                "lat": 10.60919,
                "lng": -67.01518,
                "floors": 7,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/ed8223a9-9b47-4131-bc61-b0c7dc9cbb36.png",
                "real": true
        },
        {
                "id": "f71722e7-402d-412f-93e2-b2703c3292e9",
                "name": "Qta. Mariangela",
                "zone": "Estadio de pelota",
                "address": "Calle 4, Catia La Mar 1162, playa grande. Circunvalación norteLa Guaira, Venezuela",
                "lat": 10.60505,
                "lng": -67.03363,
                "floors": 4,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/6f884ff8-6139-4a98-a92c-62396b82a01a.heic",
                "real": true
        },
        {
                "id": "f11ab6e5-c436-4a17-a9ee-a5caffbaf0a0",
                "name": "Residencias Caribe",
                "zone": "El Palmar Este",
                "address": "J592+G2Q, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61229,
                "lng": -66.83928,
                "floors": 7,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/1fe649c5-7bb8-4307-a537-c9af99f892cd.jpeg",
                "real": true
        },
        {
                "id": "ef7729a8-8777-420b-933d-98b52801fc0a",
                "name": "Residencias Orca",
                "zone": "Playa Grande",
                "address": "JX5R+RV6, Maiquetía 1162, La Guaira, Venezuela",
                "lat": 10.60954,
                "lng": -67.00787,
                "floors": 5,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/738938f4-6825-4c98-91bf-707c70b951fc.jpeg",
                "real": true
        },
        {
                "id": "ee983e73-68a2-4342-ad09-02b98e3dceab",
                "name": "Hotel Aeropuerto",
                "zone": "Catia La Mar",
                "address": "Calle 3, Catia La Mar 1162, La Guaira, Venezuela",
                "lat": 10.60794,
                "lng": -67.03252,
                "floors": 10,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/04d0b681-d28d-4837-bcc8-2d24ff358edb.jpeg",
                "real": true
        },
        {
                "id": "fb5a3364-76bc-46ee-a542-21a38617cebc",
                "name": "Aguja Azul Maiquetía",
                "zone": "Playa Grande",
                "address": "10.611169, -67.017788, Maiquetía 1162, La Guaira, Venezuela",
                "lat": 10.61114,
                "lng": -67.01779,
                "floors": 6,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/b70b6678-6253-4174-8d1d-086e3c89f05e.png",
                "real": true
        },
        {
                "id": "eaaca355-fbd4-48a0-8e05-5a868775a73f",
                "name": "CARABALLEDA SOL",
                "zone": "Caraballeda",
                "address": "Calle Bajada El Caribe, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.6119,
                "lng": -66.84675,
                "floors": 4,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/e0c0c7ec-6301-4c59-b3a0-54c75a838437.jpeg",
                "real": true
        },
        {
                "id": "e9a905c0-f8cd-4b48-b9d5-41c147bc0ee3",
                "name": "Edificio El Jurel",
                "zone": "Playa Grande",
                "address": "Playa Grande, Maiquetía 1162, La Guaira, Venezuela",
                "lat": 10.61039,
                "lng": -67.00838,
                "floors": 5,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/9fb81a02-2fa5-43a0-bbfd-fb7fcfd08f6c.png",
                "real": true
        },
        {
                "id": "e53bcebf-78a0-4efc-a95f-cdf2be39ae81",
                "name": "Residencias Capri",
                "zone": "Frente al Club playa grande",
                "address": "Playa Grande, Maiquetía 1162, La Guaira, Venezuela",
                "lat": 10.61102,
                "lng": -67.0166,
                "floors": 8,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/9b89f3f6-5043-4daf-980e-c17a995be1c5.jpeg",
                "real": true
        },
        {
                "id": "e38238a2-22e4-4766-bb33-7a31ed615a90",
                "name": "Edificio Marú",
                "zone": "Abajo había una panadería",
                "address": "Av. La Atlántida, Catia La Mar, calle 11, La Guaira, Venezuela",
                "lat": 10.60371,
                "lng": -67.02965,
                "floors": 5,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/e28155ac-f216-42c1-b24b-8897e55e9605.jpg",
                "real": true
        },
        {
                "id": "e2e8c152-8b04-4185-b648-7c2ce4ab90ce",
                "name": "Camuri grande Edo la Guaira",
                "zone": "Camuri grande",
                "address": "La Guaira, Venezuela",
                "lat": 10.60248,
                "lng": -66.93134,
                "floors": 6,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/e9b39161-8393-4d37-a82f-0de48475272f.jpg",
                "real": true
        },
        {
                "id": "dbecd710-20fa-4419-b679-1b86b6f0d3ec",
                "name": "Residencias Mansión Club Caraballeda",
                "zone": "Caribe",
                "address": "Av. José María España, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61239,
                "lng": -66.83434,
                "floors": 9,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/3cc388b8-1202-4100-942d-71153dc2570a.png",
                "real": true
        },
        {
                "id": "daff2941-42a9-4153-8d59-b776fb8576b0",
                "name": "Residencias CELTAMAR I",
                "zone": "Caraballeda",
                "address": "J592+82Q, Caraballeda, La Guaira, Venezuela",
                "lat": 10.61212,
                "lng": -66.84989,
                "floors": 8,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/07853895-1007-4139-a7fa-5ffdbcb53e2f.jpeg",
                "real": true
        },
        {
                "id": "d9236806-ee17-4059-880d-07d1a5aec143",
                "name": "Residencia Costa Brava",
                "zone": "Caribe",
                "address": "Avenida Guaicaipuro, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.6111,
                "lng": -66.84572,
                "floors": 7,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/bb6fdcff-f3c5-4f7a-80b3-7c94b40ea8dd.png",
                "real": true
        },
        {
                "id": "d61ae669-b401-4dfd-ae79-ac1d422b981c",
                "name": "Edificio Las Aves",
                "zone": "La Atlántida",
                "address": "Calle 1, Catia La Mar 1162, La Guaira, Venezuela",
                "lat": 10.60448,
                "lng": -67.0361,
                "floors": 5,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/eaf2ead6-1e00-4b30-a34a-f37601736fcb.jpg",
                "real": true
        },
        {
                "id": "d2fc90df-bf97-4db2-8dc8-67d54ecda3d7",
                "name": "C.C Costa del Sol",
                "zone": "Caraballeda",
                "address": "J593+7J, Caraballeda, La Guaira, Venezuela",
                "lat": 10.61108,
                "lng": -66.84594,
                "floors": 8,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/0c8635d6-cae6-446b-b2bf-33f5d9bcfa29.jpeg",
                "real": true
        },
        {
                "id": "d0721aa0-02a8-45d5-ab67-3b9a5e746584",
                "name": "Malibu Suite",
                "zone": "Tanaguarena",
                "address": "Tanaguarena, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61193,
                "lng": -66.83805,
                "floors": 6,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/ca1dc219-49fb-4724-8810-a7f1a5831946.jpg",
                "real": true
        },
        {
                "id": "ce13c8cb-d3dc-405e-9162-e0fbf9775e85",
                "name": "Los Tamarindos II",
                "zone": "Caraballeda",
                "address": "Caraballeda, La Guaira, Venezuela",
                "lat": 10.61117,
                "lng": -66.84718,
                "floors": 8,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/d3236d14-d14a-4f2e-9d70-11df1e916828.jpeg",
                "real": true
        },
        {
                "id": "cd96295b-8073-44c8-8f44-d5991cab72e4",
                "name": "Rocapark",
                "zone": "Caraballeda",
                "address": "J584+J29, Caraballeda, La Guaira, Venezuela",
                "lat": 10.61245,
                "lng": -66.84489,
                "floors": 7,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/8f532181-bbe1-4910-acc4-e6d7adff1db0.jpeg",
                "real": true
        },
        {
                "id": "ca89c482-c5ff-4816-8420-55f4d8a1fc58",
                "name": "Edificio Dist. Rosanday",
                "zone": "El Palmar Oeste",
                "address": "J46P+P73, Av. José María España, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61176,
                "lng": -66.86431,
                "floors": 6,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/2ca0081b-a29b-4dad-93d4-d61fd4bf03e5.png",
                "real": true
        },
        {
                "id": "c52ce0c5-455d-4395-9630-1d4916c6be57",
                "name": "Residencia Ilona",
                "zone": "Caribe",
                "address": "Av. José María España, Caraballeda, La Guaira, Venezuela",
                "lat": 10.61295,
                "lng": -66.83749,
                "floors": 8,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/744330f8-9067-4eb4-adac-74f9ea81bc53.jpeg",
                "real": true
        },
        {
                "id": "bcc628e5-414c-4b8b-84e8-a2b3876c5956",
                "name": "Res. Mansión del Mar",
                "zone": "Caraballeda",
                "address": "J579+55R, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61268,
                "lng": -66.83212,
                "floors": 4,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/f440d782-0788-4566-8a90-fd346f0ad856.png",
                "real": true
        },
        {
                "id": "bc6dfbee-b6fe-4f83-8332-0be2235310ce",
                "name": "Residencia Avilamar",
                "zone": "Tanaguarena",
                "address": "C. Los Apamates, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61166,
                "lng": -66.82746,
                "floors": 6,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/d8a601c1-ae6a-4f1a-b990-9b57cdab4203.jpeg",
                "real": true
        },
        {
                "id": "bac77932-8834-421e-9645-1c86617deaf1",
                "name": "Residencias Vallarta",
                "zone": "Playa Grande",
                "address": "JX5J+Q99, Avenida Nte., Maiquetía 1162, La Guaira, Venezuela",
                "lat": 10.60942,
                "lng": -67.01902,
                "floors": 4,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/bf922ebe-7b1a-428d-9258-ce8d10beb875.jpeg",
                "real": true
        },
        {
                "id": "b922abf0-65e6-45b6-bd4b-9c79aaed235d",
                "name": "Residencias Cumanagoto",
                "zone": "Playa Grande",
                "address": "Playa Grande, Maiquetía 1162, La Guaira, Venezuela",
                "lat": 10.61093,
                "lng": -67.01023,
                "floors": 9,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/e3e05114-f7a9-44ba-98a6-c7d2b1fade64.png",
                "real": true
        },
        {
                "id": "b8050012-51b7-4cb8-b52b-5fc6e0e5799f",
                "name": "Edificio pelicano",
                "zone": "Catia La Mar",
                "address": "Av Principal de Playa Grande, Catia La Mar 1162, La Guaira, Venezuela",
                "lat": 10.60405,
                "lng": -67.02728,
                "floors": 7,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/0e029cf3-a629-41d3-ade6-4f9efa2c0476.jpg",
                "real": true
        },
        {
                "id": "d3c33fea-5104-41da-bb30-c1bdd620c7ec",
                "name": "Comercial la Goleta ( Celicor )",
                "zone": "Avenida la costanera",
                "address": "Avenida Principal de la costanera con calle 4, los corales caraballeda",
                "lat": 10.61168,
                "lng": -66.85912,
                "floors": 5,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/da82993a-52f6-45ee-8a48-0430cc5ba54f.jpeg",
                "real": true
        },
        {
                "id": "b0d051c8-4a85-4b0c-b34c-4efb9917c14c",
                "name": "Residencias Auro",
                "zone": "El Palmar Este",
                "address": "J592+J7M, Av. José María España, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61143,
                "lng": -66.84932,
                "floors": 5,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/5e5a9246-b6e5-4349-ab40-b84c78472436.jpeg",
                "real": true
        },
        {
                "id": "af84a7d3-cc60-4224-bdac-3e546da2c9cb",
                "name": "Tanamar",
                "zone": "Tanaguarena",
                "address": "1165 Av La Playa, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61205,
                "lng": -66.8258,
                "floors": 4,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/b29df80a-4113-4527-a05e-db4d3fdbf183.png",
                "real": true
        },
        {
                "id": "ae2adef5-4bd6-400a-b0a3-94cf9b868948",
                "name": "Pez Vela",
                "zone": "Playa Grande",
                "address": "Playa Grande, Maiquetía 1162, La Guaira, Venezuela",
                "lat": 10.61163,
                "lng": -67.01745,
                "floors": 8,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/521e5b19-d3da-4ffb-9fb4-3fb0a08c7765.jpeg",
                "real": true
        },
        {
                "id": "ad00cd35-0351-4c61-b75e-ec282e4bb594",
                "name": "Edif Malecon",
                "zone": "Playa Grande",
                "address": "Calle 5, Maiquetía 1162, La Guaira, Venezuela",
                "lat": 10.61062,
                "lng": -67.01771,
                "floors": 4,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/3052c20e-470b-4397-ac0f-f19748a03874.jpg",
                "real": true
        },
        {
                "id": "ab509407-296a-4881-8474-82ab01d43742",
                "name": "Residencias Mediterranee",
                "zone": "Puerto Viejo",
                "address": "JX5C+74V, Calle 4, Maiquetía 1162, La Guaira, Venezuela",
                "lat": 10.60823,
                "lng": -67.02972,
                "floors": 9,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/9d51836e-2d23-4f9a-8d4f-ec7adce76ecb.png",
                "real": true
        },
        {
                "id": "a806afd1-c32a-46a2-b6dc-338958ce6665",
                "name": "Residencias Belair",
                "zone": "Macuto",
                "address": "Calle Charaima c/c Los Apamates, Urb. Tanaguarenas",
                "lat": 10.60248,
                "lng": -66.93134,
                "floors": 5,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/209acb66-e8be-4e79-b599-2c683eb7b3da.jpeg",
                "real": true
        },
        {
                "id": "a61b1a39-e320-46ef-a910-5d9872738fc7",
                "name": "Escuela Naval",
                "zone": "Las Zorra",
                "address": "C. Alferez de Fragata Don Vicente Parrado, Catia La Mar 1162, La Guaira, Venezuela",
                "lat": 10.59138,
                "lng": -67.04747,
                "floors": 6,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/ff65781d-e04f-48b7-b1ae-d6d4f32210ac.png",
                "real": true
        },
        {
                "id": "a416a5d8-589b-41e4-8ad6-6957f475a51e",
                "name": "Edificio Álamo",
                "zone": "Urbanización Álamo",
                "address": "Av. Álamo, Macuto 1164, La Guaira, Venezuela",
                "lat": 10.6026,
                "lng": -66.9046,
                "floors": 7,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/da0065d7-29c0-4ce9-99ee-78802ee03074.jpg",
                "real": true
        },
        {
                "id": "a25d0038-93ab-4cb4-a944-ab75eaf11078",
                "name": "Mediterraneo",
                "zone": "Caribe",
                "address": "Caribe, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61022,
                "lng": -66.84095,
                "floors": 7,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/42732c8d-503a-43ef-ab79-eaa7e1ca093c.jpeg",
                "real": true
        },
        {
                "id": "94697f0d-8d43-447d-b6b9-61cbc60d1e4e",
                "name": "Edificio Rompemar II",
                "zone": "Caraballeda",
                "address": "J594+756 Edificio Rompemar II, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61131,
                "lng": -66.84459,
                "floors": 9,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/d64ee90a-93cd-4474-a401-41ca4c2cca36.png",
                "real": true
        },
        {
                "id": "943ceec0-936d-4363-bfe4-85af185049df",
                "name": "Residencias Karina",
                "zone": "Caribe",
                "address": "J565+XF7, Av. Granada, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61176,
                "lng": -66.8402,
                "floors": 8,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/62b81241-bc25-4217-ab7e-560baa66f361.jpeg",
                "real": true
        },
        {
                "id": "931cafc5-d2b1-49b1-b078-a49c4466a635",
                "name": "Residencia relax Vista Mar",
                "zone": "Playa Grande",
                "address": "JX6Q+3V7, Maiquetía 1162, La Guaira, Venezuela",
                "lat": 10.61041,
                "lng": -67.01247,
                "floors": 6,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/791c29a8-d47e-4799-8082-6c2b42b7b43a.jpeg",
                "real": true
        },
        {
                "id": "9ac03cc6-798c-4f24-bc61-8d7921061ce2",
                "name": "Aguja Azul",
                "zone": "Naiguatá",
                "address": "Frente a las canchas deportivas, Residencias Aguja Azul, C. Coromoto, Naiguatá 1166, La Guaira, Venezuela",
                "lat": 10.61126,
                "lng": -66.74211,
                "floors": 5,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/ab103f91-d848-446d-ad06-252ea01dea5d.png",
                "real": true
        },
        {
                "id": "8fe92e10-249d-4c54-a3b3-a339067836f1",
                "name": "Residencias Palma Real -La Guaira",
                "zone": "Caribe",
                "address": "CALLE LA PLAYA, RESIDENCIAS PALMA REAL, ZONA CARIBE, PARROQUIA CARABALLEDA, FRENTE AL ANTIGUO HOTEL MELIÁ, LA GUAIRA.",
                "lat": 10.61107,
                "lng": -66.83685,
                "floors": 9,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/d9601488-8324-421a-8908-f4155076c88d.png",
                "real": true
        },
        {
                "id": "8bdb211c-d95e-4c51-b686-26220286d6b9",
                "name": "Residencias Marycielo",
                "zone": "Caribe",
                "address": "J574+288, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61244,
                "lng": -66.84384,
                "floors": 8,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/968439fd-7386-47e0-8b73-a82033597b2b.jpg",
                "real": true
        },
        {
                "id": "4fe6c04b-01b7-48b1-9864-740c08f8ac78",
                "name": "Residencia Botánico",
                "zone": "Av. Jardín Botánico",
                "address": "Jardín botánico",
                "lat": 10.61085,
                "lng": -66.82662,
                "floors": 9,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/93611bc7-c84a-4e03-ac80-0ca5e0d42623.jpeg",
                "real": true
        },
        {
                "id": "7fbffebe-55b0-45d2-be4c-ef4e2910d374",
                "name": "Residencia Gradisca",
                "zone": "Macuto",
                "address": "Av. José María España, Macuto, La Guaira, Venezuela",
                "lat": 10.60992,
                "lng": -66.881,
                "floors": 7,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/46eb5694-b6ec-428f-b1ce-2673573e05c1.png",
                "real": true
        },
        {
                "id": "77d3befd-e64e-413f-9cc1-9ad6d5debb24",
                "name": "Marianamar",
                "zone": "Caraballeda",
                "address": "J586+CF7, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61288,
                "lng": -66.83882,
                "floors": 7,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/342f688e-7643-4edf-a20d-e3277184ddd6.jpeg",
                "real": true
        },
        {
                "id": "7251adbe-6f62-4a2a-b8d5-21537a9df522",
                "name": "Residencias Ibiza",
                "zone": "Tanaguarena",
                "address": "J56G+35V Urbanizacion Tanaguarena, Av La Playa, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61109,
                "lng": -66.82117,
                "floors": 8,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/27a3eed2-b21b-4b37-9de0-0261df2f0e5b.jpeg",
                "real": true
        },
        {
                "id": "722b92c4-f93a-41ed-8529-24cab0b06e3d",
                "name": "Porto Fino Beach",
                "zone": "Tanaguarena",
                "address": "Tanaguarena, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61218,
                "lng": -66.82286,
                "floors": 4,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/063bb03a-166f-47d5-80b5-f5ebbc6acf34.jpeg",
                "real": true
        },
        {
                "id": "a2e49d2a-9aa9-4fbd-a866-79870afa8886",
                "name": "Residencias Puerto Coral",
                "zone": "Macuto",
                "address": "J437+PWV, Macuto 1164, La Guaira, Venezuela",
                "lat": 10.61119,
                "lng": -66.88423,
                "floors": 5,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/433f8771-5768-409f-81a0-b16d445d00e9.jpeg",
                "real": true
        },
        {
                "id": "6faf298e-c30b-4f02-9aa6-960690c18c0a",
                "name": "edificio Mónaco naiguata",
                "zone": "Santa Fe",
                "address": "Av. José María Vargas, Naiguatá 1166, La Guaira, Venezuela",
                "lat": 10.61295,
                "lng": -66.73731,
                "floors": 4,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/cf61ce6d-8b4a-4096-977f-88cc4b7a5793.jpg",
                "real": true
        },
        {
                "id": "768bcc66-d813-450a-8860-49f7e8182d1f",
                "name": "La Joya",
                "zone": "Caraballeda",
                "address": "Caraballeda, La Guaira, Venezuela",
                "lat": 10.61206,
                "lng": -66.84299,
                "floors": 5,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/c364ffd5-6ac9-427c-a163-438979356a4b.png",
                "real": true
        },
        {
                "id": "6e4a8196-ed52-4dce-b532-68076b0ee489",
                "name": "Naiguata",
                "zone": "La Guaira",
                "address": "La Guaira, Venezuela",
                "lat": 10.60248,
                "lng": -66.93134,
                "floors": 4,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/971fc1af-a323-45a2-86fb-e36228d88c02.jpg",
                "real": true
        },
        {
                "id": "6b8a35bd-90aa-4d29-98a4-f70e111103d5",
                "name": "Edificio costa brava los corales",
                "zone": "Los Corales",
                "address": "Los Corales, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61156,
                "lng": -66.85686,
                "floors": 7,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/d63ecce0-bb40-44f8-b33d-d080fc3e1316.png",
                "real": true
        },
        {
                "id": "69819577-c245-4693-a04c-b78f9d3661ec",
                "name": "Res Punta Brisas",
                "zone": "Detras del Hotel las Quince letras",
                "address": "Calle san Andrés Res punta Brisas",
                "lat": 10.61064,
                "lng": -66.88647,
                "floors": 5,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/79421b02-fda8-4e51-aad2-f86da82be8ef.jpg",
                "real": true
        },
        {
                "id": "68d2c35d-19b8-490d-9db1-6e4837ec86ed",
                "name": "Residencias Coral Park",
                "zone": "Los Corales",
                "address": "Residencias Coral Beach, Av. La Costanera, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61176,
                "lng": -66.85476,
                "floors": 9,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/23eb22bb-298f-420e-8c50-c8f1b869c71e.jpeg",
                "real": true
        },
        {
                "id": "682db6d9-eefd-4d5c-b408-8e138778a4f0",
                "name": "Edificio Las Palmas o punta piedra (ver video)",
                "zone": "Camurí Chico",
                "address": "Avenida José María España, Macuto 1164, La Guaira, Venezuela",
                "lat": 10.60958,
                "lng": -66.87573,
                "floors": 8,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/98ff3c11-961e-4400-bca0-6dfc63406cc8.jpg",
                "real": true
        },
        {
                "id": "65ea1d2b-0be3-4e15-b396-7ae4a4f9bc09",
                "name": "Victor",
                "zone": "Caribe",
                "address": "7076 Coronado Way",
                "lat": 10.61169,
                "lng": -66.84248,
                "floors": 6,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/a37803a4-2e8b-402d-8ad2-e9e8d4e7daa9.jpeg",
                "real": true
        },
        {
                "id": "65e6a451-017c-47de-915a-28d04d2eeb31",
                "name": "Residencias Playate “Playa T”",
                "zone": "Maiquetía",
                "address": "JX5P+V4V, Maiquetía, La Guaira, Venezuela",
                "lat": 10.60979,
                "lng": -67.01504,
                "floors": 5,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/c3cdc4d2-3d60-44e4-9e22-0be7d07afbfc.jpeg",
                "real": true
        },
        {
                "id": "604cc2aa-834d-4c60-b26c-c31cdb0bae78",
                "name": "Residencias Perlamar",
                "zone": "urbanizacion caribe",
                "address": "Caribe, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61117,
                "lng": -66.84174,
                "floors": 9,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/f8d54b87-aea3-49af-af80-429810af2ea1.jpg",
                "real": true
        },
        {
                "id": "5fffc2a4-154d-44af-95d0-768af9e60e72",
                "name": "Restaurar rompeolas",
                "zone": "Catia La Mar",
                "address": "Av Principal de Playa Grande, Catia La Mar 1162, La Guaira, Venezuela rompeolas",
                "lat": 10.60894,
                "lng": -67.02736,
                "floors": 4,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/b4869184-c2e3-4f38-8834-6cfa1b892b00.jpeg",
                "real": true
        },
        {
                "id": "5f0ec04c-d93b-496c-9c6e-20a4e5fcd8c1",
                "name": "Residencia oasis beach",
                "zone": "Playa Grande",
                "address": "JX6Q+2M8, Maiquetía 1162, La Guaira, Venezuela",
                "lat": 10.61018,
                "lng": -67.01141,
                "floors": 4,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/2c4b9bbe-32e5-4b9f-831a-adc5e5c7e67f.png",
                "real": true
        },
        {
                "id": "5b397656-c97a-4fb6-b972-0ec4c9d64e72",
                "name": "Residencia Bellevue",
                "zone": "Caraballeda",
                "address": "Caraballeda, 1165, La Guaira, Venezuela",
                "lat": 10.58495,
                "lng": -66.82011,
                "floors": 8,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/67cee3bc-f928-4837-80a0-32d28ff136e6.jpg",
                "real": true
        },
        {
                "id": "599ddcd6-55ca-4ad2-872f-486a79284a0f",
                "name": "caraballeda beach",
                "zone": "Tanaguarena",
                "address": "1165 Av La Playa, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61236,
                "lng": -66.82346,
                "floors": 8,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/bbd8a8a4-3c46-4b83-803d-7c7d5ffeda11.jpeg",
                "real": true
        },
        {
                "id": "599d5a27-aab8-4f71-9894-7dc5fb43d751",
                "name": "Nautilus",
                "zone": "Playa grande",
                "address": "Av Principal de Playa Grande, Catia La Mar 1162, La Guaira, Venezuela",
                "lat": 10.61305,
                "lng": -67.02221,
                "floors": 7,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/23f96fbd-0ca2-432c-ac86-5290417463a3.jpeg",
                "real": true
        },
        {
                "id": "5967f2ec-0b33-4720-ac64-98c722510e8d",
                "name": "Residencias Bravamar",
                "zone": "Caribe",
                "address": "Av. Circunvalacion, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61152,
                "lng": -66.84603,
                "floors": 9,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/c79eb208-81b3-46df-86c2-da7e18c08de2.jpeg",
                "real": true
        },
        {
                "id": "5786d599-0301-4b70-b0fb-17c6015e9d45",
                "name": "Residencia Camuri Park",
                "zone": "Naiguatá",
                "address": "residencia Camuri Park, Naiguatá 1166, La Guaira, Venezuela",
                "lat": 10.61194,
                "lng": -66.71248,
                "floors": 8,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/f5d86a60-0296-4dd0-90b7-28a74ef8fbd4.png",
                "real": true
        },
        {
                "id": "64c74510-3538-4634-babd-f93601eea966",
                "name": "Residencia Carmela Mar",
                "zone": "Tanaguarena",
                "address": "J55F+WPG, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.60981,
                "lng": -66.82566,
                "floors": 6,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/0a33d842-3e49-4668-98df-28ad85b5febd.jpg",
                "real": true
        },
        {
                "id": "560fb10f-015f-480a-957d-a77de2b6657e",
                "name": "La Estrella",
                "zone": "Urbanización Álamo",
                "address": "Avenida La Playa, Macuto 1164, La Guaira, Venezuela",
                "lat": 10.60526,
                "lng": -66.90036,
                "floors": 7,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/67f2631a-669e-4eca-8aca-6cc066d38789.png",
                "real": true
        },
        {
                "id": "55f8d444-9178-4272-96ab-b47cf8e6bef2",
                "name": "Residencias Aquarium",
                "zone": "Catia la mar",
                "address": "Av. La Atlántida, Catia La Mar 1162, La Guaira, Venezuela",
                "lat": 10.60933,
                "lng": -67.0314,
                "floors": 4,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/4d9f6042-310e-47ec-ab94-27e87bdb542d.jpeg",
                "real": true
        },
        {
                "id": "4f11d315-84a5-4e55-916b-0a3820ce48d8",
                "name": "Residencias Airemar",
                "zone": "Tanaguarena",
                "address": "J56F+W47, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.60703,
                "lng": -66.82618,
                "floors": 8,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/e569d871-238a-4336-aa4e-a6e488408f5c.jpg",
                "real": true
        },
        {
                "id": "4edbd9dd-1b82-4ae3-adb3-2f456001c09f",
                "name": "Bloque 3 la Paez",
                "zone": "La paez",
                "address": "Av. La Páez, Catia La Mar 1162, La Guaira, Venezuela",
                "lat": 10.60004,
                "lng": -67.02473,
                "floors": 8,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/55c0418f-d702-4ba0-afcb-1f48be97396c.jpg",
                "real": true
        },
        {
                "id": "4d703d45-8f02-4224-91b1-08d8228c934e",
                "name": "Edificio Caribe detras de las 15 letras",
                "zone": "Caribe",
                "address": "J577+G33, paso 3, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61125,
                "lng": -66.83732,
                "floors": 6,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/7707c8e1-5f83-4c12-bd86-ee612f199953.png",
                "real": true
        },
        {
                "id": "4b95514a-3032-4685-b292-5ab0d6b81900",
                "name": "Maria Andreina Castillo en Velo horizonte",
                "zone": "Playa grande",
                "address": "Catia La Mar, La Guaira, Venezuela",
                "lat": 10.60064,
                "lng": -67.03923,
                "floors": 6,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/49b80768-9fd2-4c6d-adec-a74d21370c71.jpg",
                "real": true
        },
        {
                "id": "4a48cd17-de31-4c06-8f94-42231d17ab10",
                "name": "Tanaguarena",
                "zone": "Tanaguarena",
                "address": "Tanaguarena, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61027,
                "lng": -66.82458,
                "floors": 4,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/bd3af60e-38c9-4349-a51d-9a8ca99b650d.jpg",
                "real": true
        },
        {
                "id": "4825da63-f3cb-4e0e-b41c-bb288b438adf",
                "name": "Residencia la Trinidad",
                "zone": "Playa grande calle 9",
                "address": "Calle 9 playa grande Edo la Guaira",
                "lat": 10.61045,
                "lng": -67.01906,
                "floors": 8,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/850b97aa-1564-473d-9622-bb7ed4c69ff9.webp",
                "real": true
        },
        {
                "id": "45832954-90f5-4b12-9911-4c294a434f3d",
                "name": "Residencias Club Bahía Mar",
                "zone": "Los Corales",
                "address": "J49W+6GR, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61189,
                "lng": -66.85372,
                "floors": 6,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/e2eab6c4-d025-47a8-a959-262aaf689abc.jpeg",
                "real": true
        },
        {
                "id": "439d9e37-b0e9-4384-b3a2-57e70c62f321",
                "name": "Supermercado El Rey de Carayaca",
                "zone": "Carayaca",
                "address": "Calle principal de, GVMM+85Q, C. Real, Carayaca 1167, La Guaira, Venezuela",
                "lat": 10.53304,
                "lng": -67.11691,
                "floors": 4,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/c5efbf8e-4dad-4b0e-9717-e5ac342426c5.jpeg",
                "real": true
        },
        {
                "id": "3f43ed94-d7a0-45cc-a4b5-67b0d1871628",
                "name": "La lucha",
                "zone": "Urimare la lucha catia la mar",
                "address": "C. interna de La Lucha, Catia La Mar 1162, La Guaira, Venezuela",
                "lat": 10.60342,
                "lng": -67.02007,
                "floors": 7,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/c74d853b-0ac8-4370-9b8c-5de9d0782c81.jpg",
                "real": true
        },
        {
                "id": "39ba62e2-1ab9-414a-a009-e31ae13400f5",
                "name": "Mision vivienda av cariaco oeste",
                "zone": "Av cariaco oeste",
                "address": "J586+63P, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61187,
                "lng": -66.83979,
                "floors": 8,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/83db14af-99d3-433c-a118-a7a5acdfad5c.jpg",
                "real": true
        },
        {
                "id": "37130602-c8ff-4b49-8a9e-10bed627f8bd",
                "name": "Residencia Tamiami",
                "zone": "Los Corales",
                "address": "Av. Caraballeda, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61239,
                "lng": -66.85274,
                "floors": 8,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/c4e393de-9579-4432-87a4-fce356269564.jpg",
                "real": true
        },
        {
                "id": "35e96d18-b273-4428-9866-b07c0650911c",
                "name": "Hotel Chipi’s beach",
                "zone": "Playa Grande",
                "address": "HOTEL CHIPIS BEACH, Catia La Mar 1162, La Guaira, Venezuela",
                "lat": 10.6083,
                "lng": -67.01063,
                "floors": 8,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/a68b66db-3848-4258-8843-f9c5e7959e64.jpeg",
                "real": true
        },
        {
                "id": "2f258885-0a57-458a-b7c6-4a1a9309aa2a",
                "name": "Iglesia San Sebastian de Maiquetia",
                "zone": "Maiquetía",
                "address": "C. Real de Maiquetía, Maiquetía 1161, La Guaira, Venezuela",
                "lat": 10.59568,
                "lng": -66.95211,
                "floors": 8,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/28d6f696-1446-4c07-a0d0-a550635acb61.png",
                "real": true
        },
        {
                "id": "2b302d74-7cb3-42db-9248-1829bd57886a",
                "name": "Mini CC K-rol",
                "zone": "El Palmar Este",
                "address": "Av. La Costanera, Caraballeda, La Guaira, Venezuela",
                "lat": 10.61222,
                "lng": -66.84813,
                "floors": 5,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/105bf557-bd2b-4460-ad76-e785f20d974d.jpg",
                "real": true
        },
        {
                "id": "26bd0d5f-0676-4d81-9f15-2e7ffc783915",
                "name": "Edificio Agua Marina",
                "zone": "Al lado del hotel las 15 letras",
                "address": "Macuto 1164, La Guaira, Venezuela. Al lado del hotel las 15 letras",
                "lat": 10.60724,
                "lng": -66.88486,
                "floors": 7,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/9078cc10-69ac-4134-9551-d4c003c1462f.jpg",
                "real": true
        },
        {
                "id": "252bf13a-2749-478d-9e0a-887c920ec68a",
                "name": "Edificio Miramar",
                "zone": "Caribe",
                "address": "Caribe, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61288,
                "lng": -66.84663,
                "floors": 6,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/fffc9159-c305-4e5c-80c9-ec002558ab7c.png",
                "real": true
        },
        {
                "id": "2527a72e-9996-43bf-bd4c-58defeeb37f6",
                "name": "Residencias El Molino",
                "zone": "Caribe",
                "address": "Avenida Guaicaipuro, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61222,
                "lng": -66.84371,
                "floors": 5,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/ae089b42-d2c2-4d66-8a29-58bfec73f299.jpeg",
                "real": true
        },
        {
                "id": "2436a2e7-4486-4b21-8a0e-4b01665350e9",
                "name": "Residencias Mar de Leva",
                "zone": "Los Corales",
                "address": "J49W+HV4, Av. José María España, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61179,
                "lng": -66.85325,
                "floors": 9,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/eec3884c-2952-4c0a-859d-a3f2425d9714.jpg",
                "real": true
        },
        {
                "id": "45bb4324-e13f-43a6-b107-ec8731bcbdec",
                "name": "Torre F Catia La Mar",
                "zone": "Las Zorra",
                "address": "HXW5+RQ6, Catia La Mar 1162, La Guaira, Venezuela",
                "lat": 10.59705,
                "lng": -67.0406,
                "floors": 9,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/135cfcf7-8920-4bc4-9e79-ab218bd0b6a2.png",
                "real": true
        },
        {
                "id": "1fdb368d-d8d8-4bd9-ad7d-648f01e4b000",
                "name": "Residencias Arichuna Los Corales",
                "zone": "Los Corales",
                "address": "J48R+RQP, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61249,
                "lng": -66.85806,
                "floors": 9,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/f6f42e57-2dfc-4596-a48b-12674d7b2126.png",
                "real": true
        },
        {
                "id": "188debd7-d8d9-4abb-b613-2d4352169453",
                "name": "Edificio Residencial Los Corsarios",
                "zone": "Playa Grande",
                "address": "Avenida 1, Maiquetía 1162, La Guaira, Venezuela",
                "lat": 10.61071,
                "lng": -67.00977,
                "floors": 7,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/ff612f5b-e1a3-4201-b2f7-84b3cad75789.jpeg",
                "real": true
        },
        {
                "id": "12967565-2ab4-4c8b-9b87-b103b4d6bf9a",
                "name": "Residencia Los Monjes",
                "zone": "Frente Club Deportivo Ariel",
                "address": "Calle 3 con Av. Central de Playa Grande, frente al Club Deportivo Ariel, Playa Grande",
                "lat": 10.60874,
                "lng": -67.01492,
                "floors": 9,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/583f4de7-1cfc-478a-8d10-fd87e9792aca.jpg",
                "real": true
        },
        {
                "id": "11f1a66c-b94d-4fd2-a822-4d3bd536e041",
                "name": "Supermercado Roca Azul",
                "zone": "El Palmar Este",
                "address": "J592+22W, Boulevard Monteclaro, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61234,
                "lng": -66.84993,
                "floors": 7,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/ae399ba2-6c2e-438f-b638-ee18faca9134.jpg",
                "real": true
        },
        {
                "id": "102b3cb5-da3c-4baa-a164-228a3ac9727f",
                "name": "OPP 33",
                "zone": "Caribe",
                "address": "Caribe, Caraballeda 1165, opp 33",
                "lat": 10.60971,
                "lng": -66.8417,
                "floors": 5,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/0d2678d3-9c51-4d63-ae98-0a42ba885ae0.jpg",
                "real": true
        },
        {
                "id": "0d4b7fe5-1a14-421e-8f41-bd9d5f81953b",
                "name": "Hotel Catimar",
                "zone": "Catia La Mar",
                "address": "Urb Puerto Viejo, 2da Calle, Catia La Mar 1162, La Guaira, Venezuela",
                "lat": 10.60931,
                "lng": -67.02828,
                "floors": 8,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/1b6ae7ef-94f8-400c-95d4-1018a87887ef.png",
                "real": true
        },
        {
                "id": "0b79ab1c-fb17-4b4e-afac-2546562f9bbc",
                "name": "Edificio Sayemar",
                "zone": "Tanaguarena",
                "address": "J569+P77, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61179,
                "lng": -66.83183,
                "floors": 4,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/b166baf3-1a39-4d0b-86f1-ad0871ab7280.png",
                "real": true
        },
        {
                "id": "0b166f21-44fe-46c0-bf17-5f0220f0b6f2",
                "name": "Hotel Santuario La Llanada",
                "zone": "Macuto / Caraballeda",
                "address": "10.60642187610977",
                "lat": 10.60629,
                "lng": -66.87247,
                "floors": 9,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/a20ee5d8-98a9-4607-beda-edb0a8d86e47.png",
                "real": true
        },
        {
                "id": "0aca2a9f-b8b7-4e0f-a45d-5e8a0c68b638",
                "name": "Residencia Elite Beach",
                "zone": "Caribe",
                "address": "Caribe, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61294,
                "lng": -66.84408,
                "floors": 6,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/a09fbdad-243e-423f-b781-9af3cb6ab3f2.jpg",
                "real": true
        },
        {
                "id": "0a7c0fe6-4e0f-44dd-81cf-37b2d89186ec",
                "name": "Residencias Bucaneros",
                "zone": "No lo sé",
                "address": "Playa Grande, Maiquetía 1162, La Guaira, Venezuela",
                "lat": 10.61089,
                "lng": -67.01185,
                "floors": 5,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/8087393b-eb02-407a-b6b7-9217783a3ea9.jpg",
                "real": true
        },
        {
                "id": "10e09341-e7de-499e-8b58-a8a4a3f9f6ec",
                "name": "La Guaira",
                "zone": "La Guaira",
                "address": "La Guaira, 1160, La Guaira, Venezuela",
                "lat": 10.58751,
                "lng": -66.92136,
                "floors": 6,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/c1b9dd2b-e668-4fc3-bab1-4cfde72806fe.jpg",
                "real": true
        },
        {
                "id": "02f31324-b5ef-4ecb-8916-536214cbf776",
                "name": "Residencias El Nazareno",
                "zone": "Sector El Ceibo",
                "address": "J456+235, C. Guaicamacuto, Macuto 1164, La Guaira, Venezuela",
                "lat": 10.60752,
                "lng": -66.88975,
                "floors": 9,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/69097900-06b4-4ed4-acf9-4fca74af8805.jpg",
                "real": true
        },
        {
                "id": "5cd408ed-5695-4d33-b149-b5b5c23d4753",
                "name": "Tahiti",
                "zone": "Caraballeda",
                "address": "J592+95G Edificio Tahiti, Boulevard Monteclaro, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61141,
                "lng": -66.84954,
                "floors": 8,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/a7d29ad4-2094-4075-a3fc-cc3a38c71ca4.jpg",
                "real": true
        },
        {
                "id": "17de28ee-d03a-40fb-bf2a-02582c92c732",
                "name": "Palafito del mar",
                "zone": "Caraballeda",
                "address": "C. Cariaco, La Guaira 1160, La Guaira, Venezuela",
                "lat": 10.61231,
                "lng": -66.8413,
                "floors": 7,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/45c35318-cd6c-40b1-91d8-07908a132c1e.jpeg",
                "real": true
        },
        {
                "id": "70511bcd-2f49-4ce4-9127-4e0c14b2f439",
                "name": "Residencia la cascada",
                "zone": "Caribe",
                "address": "J584+66C, 1165 Av. José María España, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61205,
                "lng": -66.84448,
                "floors": 9,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/4b493a56-3621-425a-b75f-0a98870cf65c.jpeg",
                "real": true
        },
        {
                "id": "9d95d113-9eea-452d-9719-145cc1c1c4e0",
                "name": "El Tanagua",
                "zone": "Caraballeda",
                "address": "Av. José María España, Caraballeda, La Guaira, Venezuela",
                "lat": 10.61185,
                "lng": -66.84378,
                "floors": 5,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/f5ac164a-b30b-411f-aefd-f585fd17cb9e.jpg",
                "real": true
        },
        {
                "id": "41bb543d-d8bc-429e-a0ab-8ec36cf0a5f0",
                "name": "Edificio Maratea",
                "zone": "La Guaira",
                "address": "Av. José María España, Caraballeda, La Guaira, Venezuela",
                "lat": 10.61269,
                "lng": -66.84491,
                "floors": 5,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/86e1435d-1d3a-4bf3-b74f-6ce6b2fffe6b.png",
                "real": true
        },
        {
                "id": "cea51aa4-7bb7-41cf-820f-610a06290d11",
                "name": "Edificio Estrella",
                "zone": "Al lado del hotel Eduard’s",
                "address": "J34X+3VJ, Macuto 1164, La Guaira, Venezuela",
                "lat": 10.60521,
                "lng": -66.90036,
                "floors": 4,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/cf912988-3e42-481f-a872-1863a3ae46f0.jpeg",
                "real": true
        },
        {
                "id": "96a2785d-0a18-4bed-8661-7011cf911205",
                "name": "Residencias Puerto Coral",
                "zone": "Macuto",
                "address": "J468+F86, Macuto 1164, La Guaira, Venezuela",
                "lat": 10.61116,
                "lng": -66.88423,
                "floors": 8,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/b9f767f9-dda3-4cc3-af47-4848fbd9452c.png",
                "real": true
        },
        {
                "id": "232adae6-6fc1-4c73-8a19-e969ac432b06",
                "name": "Residencia karina",
                "zone": "Caribe",
                "address": "Av. Granada, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61147,
                "lng": -66.83846,
                "floors": 5,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/00f15a93-a2a9-43af-848a-d76fa98846b7.jpg",
                "real": true
        },
        {
                "id": "b20f95af-c836-4b66-83e1-a8599b2dee12",
                "name": "Residencias Aguamarina",
                "zone": "Macuto",
                "address": "J466+FW, La Guaira, Venezuela",
                "lat": 10.61119,
                "lng": -66.88769,
                "floors": 4,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/44460fe0-89e9-4792-b517-4b7ce9fa977a.jpeg",
                "real": true
        },
        {
                "id": "9cfc15c8-d399-4d83-bf4e-badc1bc5e99a",
                "name": "Res Mariola y maribel",
                "zone": "El Palmar Este",
                "address": "El Palmar Este, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.60948,
                "lng": -66.8484,
                "floors": 6,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/b60d07e9-00d3-4382-b1e7-083d2127a40f.jpg",
                "real": true
        },
        {
                "id": "353fdc6f-6680-4a82-ad3c-4838e18e67fc",
                "name": "Edificio Arcángel",
                "zone": "Urbanización Álamo",
                "address": "Avenida La Playa, Macuto 1164, La Guaira, Venezuela",
                "lat": 10.60455,
                "lng": -66.90211,
                "floors": 6,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/5b81d312-635e-4ffb-9b6b-fdce613fa618.jpeg",
                "real": true
        },
        {
                "id": "62f9aa6a-326b-4ac6-8f83-940a2662ea4e",
                "name": "Edificio La Gabarra",
                "zone": "Los Corales",
                "address": "Los Corales, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61148,
                "lng": -66.85651,
                "floors": 5,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/e9404530-9b80-4832-b749-4a02dda7a4f4.jpeg",
                "real": true
        },
        {
                "id": "0643df19-c5b9-423b-a013-3a26a1e48460",
                "name": "Res. Gran Terraza",
                "zone": "Caribe, Caraballeda",
                "address": "Av. José María España, Caraballeda, La Guaira, Venezuela",
                "lat": 10.61297,
                "lng": -66.84448,
                "floors": 5,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/83e13f04-3e32-4a9c-aff4-875f1374a617.jpeg",
                "real": true
        },
        {
                "id": "05e946ce-78df-4fc9-ae35-31f85e37fe1d",
                "name": "Res. Breña sol",
                "zone": "Caribe",
                "address": "Av. José María España, Caraballeda, La Guaira, Venezuela",
                "lat": 10.61175,
                "lng": -66.84491,
                "floors": 4,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/1d304dbe-dd11-4ee1-ab44-0defb68f938d.jpeg",
                "real": true
        },
        {
                "id": "05d5d8fe-ad87-4fae-852c-70a07ac2adf8",
                "name": "Residencias Dorado",
                "zone": "Playa Grande",
                "address": "Calle 4, Maiquetía 1162, La Guaira, Venezuela",
                "lat": 10.60928,
                "lng": -67.01658,
                "floors": 7,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/89a30323-d5d9-4834-8430-b789164a7ebf.jpg",
                "real": true
        },
        {
                "id": "1b51a5c5-0983-431a-8de6-2af5f86de221",
                "name": "Centro Comercial IP5",
                "zone": "El Palmar Este",
                "address": "J49X+FM8, Av. José María España, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.6117,
                "lng": -66.85079,
                "floors": 6,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/5be595ab-fe7c-43fd-80dd-9dd6e7d78b64.png",
                "real": true
        },
        {
                "id": "4897ca93-dec9-42b0-8ade-24ce309fefca",
                "name": "Supermercado Roca Azul",
                "zone": "Caraballeda",
                "address": "Boulevard Monte carlo con Av. Cannes. Urb. Palmar Este. Caraballeda, Edo. La Guaira.",
                "lat": 10.61276,
                "lng": -66.84992,
                "floors": 6,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/c505d082-b0f2-476e-9002-bb15b04b8218.png",
                "real": true
        },
        {
                "id": "ee743536-a421-4544-af81-2d1431ba3f96",
                "name": "Residencia Solymar",
                "zone": "Caraballeda",
                "address": "J56H+54G, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61044,
                "lng": -66.82217,
                "floors": 5,
                "status": "collapsed",
                "damage_level": "total",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/8f0fd972-1e99-46fd-aede-4baf89a51e26.jpg",
                "real": true
        },
        {
                "id": "45a21cfe-abef-4a71-b183-b9e882522f50",
                "name": "Solymar",
                "zone": "Caraballeda",
                "address": "J56H+54G, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61044,
                "lng": -66.82217,
                "floors": 4,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/f5849148-0b78-41fd-a3f1-df5895f6bb4f.jpg",
                "real": true
        },
        {
                "id": "09593f6f-a35f-46f8-beaa-5973bc3009bc",
                "name": "Edificio Gabarra",
                "zone": "La Guaira",
                "address": "Los Corales, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61154,
                "lng": -66.85651,
                "floors": 7,
                "status": "damaged",
                "damage_level": "parcial",
                "photo": null,
                "real": true
        },
        {
                "id": "c5e4159f-33aa-4730-bc6c-876caf58df87",
                "name": "Edificio Costa Brava",
                "zone": "Caraballeda",
                "address": "J48V+Q5G, Av. La Costanera, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61166,
                "lng": -66.85705,
                "floors": 7,
                "status": "damaged",
                "damage_level": "parcial",
                "photo": null,
                "real": true
        },
        {
                "id": "dc26a6b4-d21e-4a4a-8d29-0a048c23d924",
                "name": "Recidencias NewPort",
                "zone": "Vargas",
                "address": "C. La Playa, La Guaira, Venezuela",
                "lat": 10.61267,
                "lng": -66.82818,
                "floors": 4,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/0574c5e5-6e51-4b23-b920-75288951f57c.jpg",
                "real": true
        },
        {
                "id": "30609047-74a6-4737-8ec8-10c0647aa805",
                "name": "Residencias Villa Mar",
                "zone": "Playa Grande",
                "address": "Av. del Hotel, Maiquetía 1162, La Guaira, Venezuela",
                "lat": 10.61018,
                "lng": -67.01657,
                "floors": 7,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/fbdb9cc3-36f3-4b21-944e-674d963848ce.jpg",
                "real": true
        },
        {
                "id": "11907361-e608-4185-a18a-ee2a8705c391",
                "name": "Espomar",
                "zone": "Caraballeda",
                "address": "J579+57M, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61245,
                "lng": -66.83182,
                "floors": 7,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/81bedfe0-1046-40d8-87ad-397948fd240c.png",
                "real": true
        },
        {
                "id": "d790351d-0412-4aca-bf95-66088d7742e1",
                "name": "Residencia Acuario",
                "zone": "Tanaguarena",
                "address": "Tanaguarena, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61027,
                "lng": -66.82458,
                "floors": 7,
                "status": "damaged",
                "damage_level": "parcial",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/ee18c365-fa35-40f9-a0ef-b75960ca7b1a.png",
                "real": true
        },
        {
                "id": "1c3e7ad4-d8d5-4a37-bedd-a23d3e547ba3",
                "name": "Costabella",
                "zone": "El Palmar Este",
                "address": "Av. Cannes, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.6118,
                "lng": -66.85076,
                "floors": 5,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/1b7c9ca2-d72c-4399-960e-2cb1e440e952.png",
                "real": true
        },
        {
                "id": "895647b7-0026-42b9-953b-02623c3e98b8",
                "name": "Edificio Caribe detras de las 15 letras",
                "zone": "15 Letras",
                "address": "J577+G33, paso 3, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61015,
                "lng": -66.88344,
                "floors": 6,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/27608173-319d-4690-b718-4343701cab91.jpg",
                "real": true
        },
        {
                "id": "7f5adb59-d99a-4393-ad5a-58c7c2d162e6",
                "name": "Conjunto Residencial Montemar II",
                "zone": "Playa Grande",
                "address": "Playa Grande, Maiquetía 1162, La Guaira, Venezuela",
                "lat": 10.61239,
                "lng": -67.02359,
                "floors": 4,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/f4887717-eebd-46db-a71e-4e495a436c4e.jpg",
                "real": true
        },
        {
                "id": "9447dec0-e6ff-4515-89d8-f1561fad2779",
                "name": "Edificio Laguna Mar",
                "zone": "Caraballeda",
                "address": "Edificio Laguna Mar, Caraballeda Frente al Sheraton",
                "lat": 10.61246,
                "lng": -66.8426,
                "floors": 5,
                "status": "damaged",
                "damage_level": "parcial",
                "photo": null,
                "real": true
        },
        {
                "id": "862e33eb-879c-4979-850a-99d0b86b6877",
                "name": "Auraima",
                "zone": "Tanaguarena",
                "address": "Av. Jardín Botánico, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61164,
                "lng": -66.82658,
                "floors": 5,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/2de0cfd3-9569-4221-949f-cbc7baf3eb7e.jpeg",
                "real": true
        },
        {
                "id": "62ef0817-e24d-4aa7-bedf-3a79da0607e8",
                "name": "Edificio Sayemar",
                "zone": "La Guaira",
                "address": "Edificio Sayemar. La Guaira",
                "lat": 10.61179,
                "lng": -66.83183,
                "floors": 9,
                "status": "damaged",
                "damage_level": "parcial",
                "photo": null,
                "real": true
        },
        {
                "id": "607d1a5e-6afd-4cf2-b225-556b3065c44e",
                "name": "Edificio Tahiti",
                "zone": "Caraballeda",
                "address": "Edificio Tahiti. Caraballeda",
                "lat": 10.61255,
                "lng": -66.84954,
                "floors": 4,
                "status": "damaged",
                "damage_level": "parcial",
                "photo": null,
                "real": true
        },
        {
                "id": "2284045f-0b12-4b1e-aff7-bff41de7875d",
                "name": "Edificio Solymar",
                "zone": "Caraballeda",
                "address": "J56H+54G, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61044,
                "lng": -66.82217,
                "floors": 5,
                "status": "damaged",
                "damage_level": "parcial",
                "photo": null,
                "real": true
        },
        {
                "id": "0b361548-271d-4d47-8bdf-280954440a28",
                "name": "Residencia Alamar",
                "zone": "Playa Grande",
                "address": "JX5M+QCH, Maiquetía 1162, La Guaira, Venezuela",
                "lat": 10.60944,
                "lng": -67.0164,
                "floors": 9,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/e63624d2-d74d-490e-9e91-1df42ad2792c.jpg",
                "real": true
        },
        {
                "id": "0e9c8bdc-e9dd-4077-b567-77fc612fda2e",
                "name": "Casa",
                "zone": "Maiquetia",
                "address": "Cjón. Royal, Maiquetía 1161, La Guaira, Venezuela",
                "lat": 10.59351,
                "lng": -66.95148,
                "floors": 6,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/f4829680-9ad3-4224-8993-535f1c1138d4.jpeg",
                "real": true
        },
        {
                "id": "102dc2a1-532e-48c9-a1fb-f759bd0df9a7",
                "name": "Posada la ciénaga, La Sabana, parroquia Caruao en la Guaira",
                "zone": "Caruao",
                "address": "La Sabana, La Guaira, Venezuela",
                "lat": 10.61233,
                "lng": -66.38116,
                "floors": 6,
                "status": "damaged",
                "damage_level": "parcial",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/4943d186-baba-484c-bc04-991b19c965c5.jpeg",
                "real": true
        },
        {
                "id": "16eb571d-d2ea-43c7-befa-ec58c89d120f",
                "name": "Residencias La Laguna, Torre 3",
                "zone": "Los Magallanes de Catia",
                "address": "Los Magallanes de Catia, Caracas 1030, Distrito Capital, Venezuela",
                "lat": 10.51227,
                "lng": -66.95741,
                "floors": 8,
                "status": "damaged",
                "damage_level": "parcial",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/3b7f2c7f-175f-486d-8579-c31acf57df41.heic",
                "real": true
        },
        {
                "id": "1463caf3-94ff-47ed-bd8a-35d26a9d36a3",
                "name": "LidoSol",
                "zone": "Al lado del restaurante los tres reyes",
                "address": "Av. Jose Maria Vargas, esquina con Biarritz (Corapalito)",
                "lat": 10.61213,
                "lng": -66.86321,
                "floors": 5,
                "status": "damaged",
                "damage_level": "parcial",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/912c8e78-5750-4df9-8f69-3135580d7a46.jpg",
                "real": true
        },
        {
                "id": "2160e0f9-a424-4d37-806f-5cd140814522",
                "name": "Manuelita Saenz",
                "zone": "Sector pariata, parroquia Carlos Soublette",
                "address": "H2XP+X6J, C. José María Vargas, Maiquetía 1161, La Guaira, Venezuela",
                "lat": 10.60162,
                "lng": -66.96411,
                "floors": 5,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/c8500493-8d1f-4140-8d59-d26090db0822.jpg",
                "real": true
        },
        {
                "id": "22c92cb8-8e0a-4223-82a3-ff127f67fd7e",
                "name": "Urb. Continente",
                "zone": "Catia",
                "address": "Av. El Cuartel Urdaneta, Caracas 1030, Distrito Capital, Venezuela",
                "lat": 10.50851,
                "lng": -66.95352,
                "floors": 8,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/15a0f346-9af5-4266-96ef-b056d379e17f.jpeg",
                "real": true
        },
        {
                "id": "2b24536f-07ae-4617-b98c-f63e604e46c8",
                "name": "Edificio Selena",
                "zone": "catia",
                "address": "C. Real de Los Flores de Catia, Caracas 1030, Distrito Capital, Venezuela",
                "lat": 10.51162,
                "lng": -66.9356,
                "floors": 4,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/9628fb07-067e-49d8-a460-b32041830592.jpeg",
                "real": true
        },
        {
                "id": "2cdb3379-ddb0-4e10-860b-ebae7b4696b3",
                "name": "Edificio Tamarumo",
                "zone": "Tanaguarena",
                "address": "C. Las Acacias, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61144,
                "lng": -66.82863,
                "floors": 9,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/b66c42ae-d3b1-40f2-a5e1-51f47f166c06.jpeg",
                "real": true
        },
        {
                "id": "2e392d0a-512b-4f4f-8770-f7156451f820",
                "name": "Residencia Palmeira",
                "zone": "Caraballeda, La Guaira",
                "address": "J56G+R3R, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61139,
                "lng": -66.82494,
                "floors": 4,
                "status": "damaged",
                "damage_level": "parcial",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/a438fb27-7949-401c-a388-91e0395a433b.png",
                "real": true
        },
        {
                "id": "3903f9e8-6ba8-4217-a56d-4c0c2a405437",
                "name": "Anduriña Mar",
                "zone": "Tanaguarena",
                "address": "Residencias Anduriña Mar, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61088,
                "lng": -66.82137,
                "floors": 7,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/40c6e0aa-f640-4436-a5bd-e433f6bce0e7.jpeg",
                "real": true
        },
        {
                "id": "39be7d70-6a21-4151-83d1-a3017113def0",
                "name": "Espomar",
                "zone": "Tanaguarena",
                "address": "Tanaguarena, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61027,
                "lng": -66.82458,
                "floors": 4,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/7a9f60af-e278-45f2-ac22-af2c1c7b9a32.png",
                "real": true
        },
        {
                "id": "3d81fc7a-65f5-4c7a-bcdd-c3d7986bee0f",
                "name": "Golf Club. Caribe",
                "zone": "Caribe, Caraballeda, La Guaira",
                "address": "Av. ppal de Caribe con av Guaicaipuro",
                "lat": 10.6116,
                "lng": -66.84244,
                "floors": 5,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/10966cbc-cd11-4cb4-b10e-94289066fa11.jpg",
                "real": true
        },
        {
                "id": "4fe9290c-2a74-4c80-a05c-796cf0b49554",
                "name": "Marina grande I",
                "zone": "Maiquetía",
                "address": "Calle Real De Playa Verde, Maiquetía, La Guaira, Venezuela",
                "lat": 10.61155,
                "lng": -67.00711,
                "floors": 5,
                "status": "damaged",
                "damage_level": "parcial",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/427f9142-9696-45c0-9565-9a3fbfb9379f.png",
                "real": true
        },
        {
                "id": "5ab67d35-14e5-4e31-aac9-8f1ffc6bb8be",
                "name": "Residencias atlantico, Catia, caracas",
                "zone": "Pérez Bonalde",
                "address": "G342+JM9, Av. El Atlántico, Caracas 1030, Distrito Capital, Venezuela",
                "lat": 10.50427,
                "lng": -66.94925,
                "floors": 7,
                "status": "damaged",
                "damage_level": "parcial",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/4502ca9e-2da3-4d34-8a95-9b5f4491227f.jpeg",
                "real": true
        },
        {
                "id": "600dc09e-89fb-48a3-9bbb-3158d55d4acb",
                "name": "Pin High",
                "zone": "Caribe",
                "address": "Avenida Guaicamacuto, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61167,
                "lng": -66.84522,
                "floors": 5,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/56f40fa5-6de7-449c-9f7e-cf4f564c34ad.webp",
                "real": true
        },
        {
                "id": "6c453979-8a17-4c5b-9949-d641384d4a26",
                "name": "Camuri Mar",
                "zone": "Despues de playas los angeles",
                "address": "J7CP+WVJ, Care 1166, La Guaira, Venezuela",
                "lat": 10.613,
                "lng": -66.71286,
                "floors": 6,
                "status": "damaged",
                "damage_level": "parcial",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/9b0464c3-289d-4390-a4a7-922e40d04276.jpg",
                "real": true
        },
        {
                "id": "601fe13b-2f55-4ef1-bb14-8f3ae337955f",
                "name": "CONJUNTO RESIDENCIAL LA FUNDACION MENDOZA Res 20 2DA ETAPA",
                "zone": "Catia/sucre/alta vista",
                "address": "Avenida Principal de Altavista, Caracas 1030, Distrito Capital, Venezuela",
                "lat": 10.51844,
                "lng": -66.94185,
                "floors": 8,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/62922885-3628-4b76-90dd-1104327b3aaa.jpg",
                "real": true
        },
        {
                "id": "69cbdabc-9621-4f66-87f2-9cb0c0a59baa",
                "name": "Conjunto Residencial Playamar",
                "zone": "Playa grande",
                "address": "JX7G+6RX, Maiquetía 1162, Vargas, Venezuela",
                "lat": 10.61275,
                "lng": -67.02187,
                "floors": 5,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/4b0f74fd-e835-4160-8b55-56d7ffdee793.jpg",
                "real": true
        },
        {
                "id": "6b53605b-82a5-4815-b2fb-55cb96cd6826",
                "name": "Bleu Marine",
                "zone": "Playa Grande",
                "address": "JX5M+MW8, Maiquetía 1162, La Guaira, Venezuela",
                "lat": 10.61107,
                "lng": -67.0242,
                "floors": 7,
                "status": "damaged",
                "damage_level": "parcial",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/6d8f20ff-668a-41ea-8b46-8fa0c478b088.jpeg",
                "real": true
        },
        {
                "id": "710f62ad-7d30-4a65-908b-c6d07628d9a9",
                "name": "Residencias Avila Caribe",
                "zone": "El Palmar Este",
                "address": "Urbanizacion Tanaguarenas, Avenida del Club Entre Av Cerro Grande y Bulevard Naiguata, Residencias Avila Caribe, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.60936,
                "lng": -66.84953,
                "floors": 6,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/4fa979ac-1dbb-4dae-b8f4-356aa998e98a.jpg",
                "real": true
        },
        {
                "id": "762cc105-d7a3-4904-90d2-3f681c548465",
                "name": "Quinta San jose",
                "zone": "Colegio la merced",
                "address": "Urbanización Palmar este avenida Acapulco",
                "lat": 10.61146,
                "lng": -66.84998,
                "floors": 6,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/8c679e9c-ef5d-4e10-ba12-8bb7248fd7dc.jpg",
                "real": true
        },
        {
                "id": "7d2a7ff6-b2aa-4a4c-ace9-033d06f329fc",
                "name": "Residencias Capri Club XVI",
                "zone": "La Llanada",
                "address": "Urb Av. La Costanera, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61115,
                "lng": -66.86691,
                "floors": 5,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/40d200d0-e68b-4efc-b0a0-d11825c5844f.jpg",
                "real": true
        },
        {
                "id": "8918244a-5498-4508-aac2-fac2b3fcff9d",
                "name": "Residencias Altomar - Alto mar",
                "zone": "Playa Grande",
                "address": "JX5Q+RHP, Maiquetía 1162, La Guaira, Venezuela",
                "lat": 10.60959,
                "lng": -67.01104,
                "floors": 5,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/91454814-4f44-4e8d-90ae-9f3fd636c382.jpg",
                "real": true
        },
        {
                "id": "8ed896a5-7eda-4129-9af1-d7881264bea4",
                "name": "Parque del Caribe",
                "zone": "Urbanizacion Punta de Brisas",
                "address": "J468+7FR, Macuto 1164, La Guaira, Venezuela",
                "lat": 10.61082,
                "lng": -66.88384,
                "floors": 5,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/73f5a91e-9448-4652-b5bb-50d1e3202e3f.png",
                "real": true
        },
        {
                "id": "8b878c43-bfec-40d6-8662-804a6dd6ed97",
                "name": "Playa Alí Babá",
                "zone": "Caraballeda",
                "address": "Playa Alí Babá, Av. José María España, Caraballeda, La Guaira, Venezuela",
                "lat": 10.61145,
                "lng": -66.86565,
                "floors": 6,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/d5d62105-b181-43ff-bfb2-e7b4957fe41b.jpg",
                "real": true
        },
        {
                "id": "953fc6e0-148c-46d6-8b88-85d68b65a19c",
                "name": "Residencias Altamar",
                "zone": "Urbanización las Quince Letras",
                "address": "J456+H2R, Macuto 1164, La Guaira, Venezuela",
                "lat": 10.60874,
                "lng": -66.89026,
                "floors": 4,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/f7aafa7e-cd31-4aea-82ea-294779fb4dcf.jpg",
                "real": true
        },
        {
                "id": "95ecf65b-8cd7-40b1-b6c1-a6b611e0177b",
                "name": "Remanso II",
                "zone": "Tanaguarena",
                "address": "J57G+43F, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61183,
                "lng": -66.82484,
                "floors": 6,
                "status": "damaged",
                "damage_level": "parcial",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/b2470230-4a0e-4455-af04-f13338de420c.jpg",
                "real": true
        },
        {
                "id": "98353e89-1f0a-4a97-ae49-399b13aaaabd",
                "name": "Edificio Avila Mar",
                "zone": "Caraballeda",
                "address": "Caraballeda, La Guaira, Venezuela",
                "lat": 10.61253,
                "lng": -66.84935,
                "floors": 6,
                "status": "damaged",
                "damage_level": "parcial",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/56140783-770e-41fd-9e1d-378d7a487e2d.jpg",
                "real": true
        },
        {
                "id": "9a048169-4539-43ea-bc6b-811518ef143a",
                "name": "Residencias Brisamar",
                "zone": "Macuto",
                "address": "Subida Teleferico, Macuto 1164, La Guaira, Venezuela",
                "lat": 10.60957,
                "lng": -66.88163,
                "floors": 7,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/a3812633-9146-4988-8fca-83d980d493ef.jpg",
                "real": true
        },
        {
                "id": "99ee0417-40d9-4ce0-aa86-d4c997f6b301",
                "name": "Residencias Newport",
                "zone": "Tanaguarena",
                "address": "C. Charaima, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61152,
                "lng": -66.82857,
                "floors": 8,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/ee3b5125-c1b1-47db-b33a-d296efac2130.jpg",
                "real": true
        },
        {
                "id": "9f8fe504-dd98-47e2-9d7d-9c93e939dda9",
                "name": "Edificio MIRANDA 20A",
                "zone": "Catia",
                "address": "G383+V7V, Caracas 1030, Distrito Capital, Venezuela",
                "lat": 10.51694,
                "lng": -66.94668,
                "floors": 4,
                "status": "damaged",
                "damage_level": "parcial",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/9d78791a-ee10-4619-b6da-fbd5c8e4eb87.jpg",
                "real": true
        },
        {
                "id": "a2c6ef8a-bd62-4163-8487-2db924e34214",
                "name": "Residencia Cima Del Mar",
                "zone": "La Llanada",
                "address": "J45M+72C, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.60818,
                "lng": -66.86748,
                "floors": 6,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/73773341-bac9-4a7a-b582-6d69ffef32dc.jpeg",
                "real": true
        },
        {
                "id": "a550aff4-40a8-4cb9-a837-646d22800823",
                "name": "Residencias arrecife",
                "zone": "Caraballeda",
                "address": "Av. José María España, Caraballeda, La Guaira, Venezuela",
                "lat": 10.61184,
                "lng": -66.82711,
                "floors": 8,
                "status": "damaged",
                "damage_level": "parcial",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/3ae45176-ba76-49f3-b5a2-7e7d9a98cb69.jpg",
                "real": true
        },
        {
                "id": "bc12adc3-0575-434a-9f42-a3d7cde8c1ae",
                "name": "Las brisas",
                "zone": "Los Corales",
                "address": "Parque Mar, Avenida17-A, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.60803,
                "lng": -66.85673,
                "floors": 7,
                "status": "damaged",
                "damage_level": "parcial",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/ae8cef3c-e270-4e0e-9020-6c965dd0a51d.jpg",
                "real": true
        },
        {
                "id": "a8173ffa-1580-49ef-940c-93bc03331c46",
                "name": "Edificio David",
                "zone": "Pariata maiquetia la guaira",
                "address": "Av. Miramar, Maiquetía 1161, La Guaira, Venezuela",
                "lat": 10.59797,
                "lng": -66.96251,
                "floors": 6,
                "status": "damaged",
                "damage_level": "parcial",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/ef17ca74-7002-4fd2-8d37-84ce5a5f7d5f.jpg",
                "real": true
        },
        {
                "id": "a8e38572-a157-4e66-b4bc-1c5a7afd376b",
                "name": "Es una casa de ladrillo con color verde y rejas negras pequeñas de 3 pisos",
                "zone": "Casas en el cerro",
                "address": "C. Perro Seco, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.60612,
                "lng": -66.84508,
                "floors": 5,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/7df385f2-2dea-4e3d-990e-ce366933bf52.jpg",
                "real": true
        },
        {
                "id": "ab504a20-96e1-47e5-9507-d17181e0e4ae",
                "name": "Resd Mar Azul",
                "zone": "Playa Grande",
                "address": "JX5Q+XFQ, Av. 1, Maiquetía 1162, La Guaira, Venezuela",
                "lat": 10.60996,
                "lng": -67.01125,
                "floors": 6,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/78acc77f-d6a2-4091-96ed-fab4f18ffa94.png",
                "real": true
        },
        {
                "id": "ac2a21b8-cb63-4781-8ed3-24624030ac36",
                "name": "Coral Plaza",
                "zone": "Los Corales",
                "address": "J46W+CJP, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.6111,
                "lng": -66.85342,
                "floors": 8,
                "status": "damaged",
                "damage_level": "parcial",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/998cee3a-04b1-4176-9996-08b952d990bd.jpg",
                "real": true
        },
        {
                "id": "ad5f8a9d-b310-40c4-98af-67c4c6fecf6b",
                "name": "La riviera",
                "zone": "Playa Grande",
                "address": "Playa Grande, Maiquetía 1162, La Guaira, Venezuela",
                "lat": 10.60957,
                "lng": -67.02615,
                "floors": 5,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/52455d69-0370-490d-a0ab-80306a3eb443.jpeg",
                "real": true
        },
        {
                "id": "ae08eec0-b6b3-46f8-be96-81668280d309",
                "name": "Celtamar II",
                "zone": "Tanaguarena",
                "address": "Ave plaza el parque, la guaira, tanaguarena",
                "lat": 10.61135,
                "lng": -66.83749,
                "floors": 7,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/7009bc18-cd26-4232-aa4a-e59c8beb8c04.png",
                "real": true
        },
        {
                "id": "b249b20b-98d0-49d5-9685-3420f2d5046a",
                "name": "Edificio club de playa",
                "zone": "Al lado del taller Ferrari",
                "address": "Avenida la playa,sector el ceibo,Macuto,edificio club de playa",
                "lat": 10.60885,
                "lng": -66.88982,
                "floors": 7,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/06995c1b-1e12-4635-9d60-10ef51858690.jpeg",
                "real": true
        },
        {
                "id": "b8a46ab2-d706-4cf8-93c6-9c2aea6c2ba5",
                "name": "Edificio San Pablo",
                "zone": "Avenida baral esquina cuartel viejo a pineda edificio san pablo",
                "address": "Avenida baral esquina cuartel viejo a pineda ezifi",
                "lat": 10.55341,
                "lng": -67.00488,
                "floors": 8,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/10b0807d-6861-4ba0-b20a-e9bd653e2dfd.jpg",
                "real": true
        },
        {
                "id": "bafce602-1d71-49b7-b1bd-ea31c307040a",
                "name": "Edificio Mafrem",
                "zone": "Frente a Celicor La Costanera",
                "address": "avenida principal la costanera con calle 4, Los corales Caraballeda",
                "lat": 10.61282,
                "lng": -66.85926,
                "floors": 5,
                "status": "damaged",
                "damage_level": "parcial",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/91c9f47f-0fe8-4e3f-800b-8db27c41fa57.jpeg",
                "real": true
        },
        {
                "id": "c5a332b0-4151-4df9-98fb-65ad89be7a13",
                "name": "Edificio 13 (antes casa #13) Calle real de Alta vista entre 1ra y 2da transversal, Catia parroquia Sucre municipio libertador",
                "zone": "Calle real Alta vista Entre 1ra y 2da transversal",
                "address": "Calle Real de Alta Vista, Caracas 1030, Distrito Capital, Venezuela",
                "lat": 10.52126,
                "lng": -66.94044,
                "floors": 9,
                "status": "damaged",
                "damage_level": "parcial",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/f72bb1a8-1005-4e57-ad34-ef653a8550e2.jpg",
                "real": true
        },
        {
                "id": "c6ee89ed-0612-4b77-bfbd-e35746bd68c7",
                "name": "Edif. Los 4 Vientos",
                "zone": "Los Frailes de Catia",
                "address": "G3F7+2V6, Calle Real de Los Frailes, Caracas 1030, Distrito Capital, Venezuela",
                "lat": 10.52254,
                "lng": -66.93535,
                "floors": 8,
                "status": "damaged",
                "damage_level": "parcial",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/d417b349-ccf2-44bc-9bb4-df86ccb570a1.jpg",
                "real": true
        },
        {
                "id": "de76cac9-69d9-4408-9b30-9f9c8beb73dc",
                "name": "Parque Azul",
                "zone": "Tanaguarena",
                "address": "J57F+2XF, Av La Playa, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61296,
                "lng": -66.82508,
                "floors": 5,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/e5a7f1a0-8472-43e4-9f87-08b6ba8b28e5.png",
                "real": true
        },
        {
                "id": "ccc5e514-022f-4a3c-b639-7a107bdcc4a1",
                "name": "Torre 2 conjunto residencial La Laguna Catia",
                "zone": "Diagonal al Hospital los Magallanes de Catia",
                "address": "G28W+F3R, Caracas 1030, Distrito Capital, Venezuela",
                "lat": 10.51608,
                "lng": -66.95333,
                "floors": 9,
                "status": "damaged",
                "damage_level": "parcial",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/073aec9b-3fa0-4224-a6b6-2d307b30a773.jpg",
                "real": true
        },
        {
                "id": "cede11bb-5c05-4332-b912-e38805426c32",
                "name": "Residencias El Mástil",
                "zone": "catia la mar, playa grande",
                "address": "Resd. El Mastil, Calle 6, Maiquetía 1162, La Guaira, Venezuela",
                "lat": 10.61118,
                "lng": -67.01863,
                "floors": 6,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/43af6def-750b-4dcc-8715-0a145d0c797c.png",
                "real": true
        },
        {
                "id": "d2a4026a-f5ee-417f-ac77-9b41ffd5e69e",
                "name": "Residencia Bergantin",
                "zone": "Urbanizacion Punta de Brisas",
                "address": "Urbanizacion Punta de Brisas, Macuto, La Guaira, Venezuela",
                "lat": 10.61099,
                "lng": -66.88506,
                "floors": 8,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/f7b6aef1-07f1-420f-9722-82e34c61890d.jpg",
                "real": true
        },
        {
                "id": "dd05ec45-5068-4d10-bff7-7e585ff2a455",
                "name": "El Timonel",
                "zone": "La Atlántida",
                "address": "Calle 1. C. 2, Catia La Mar 1162, La Guaira, Venezuela",
                "lat": 10.61092,
                "lng": -67.01206,
                "floors": 5,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/49b1dd74-a4bd-4b04-bc7a-c9cacc16d5fe.jpeg",
                "real": true
        },
        {
                "id": "ddd2a9c7-2061-4f86-9528-be3a38a9dd05",
                "name": "Edificio Los Abuelos",
                "zone": "Playa Grande",
                "address": "Av. Este Dos, Maiquetía 1162, La Guaira, Venezuela",
                "lat": 10.61071,
                "lng": -67.00977,
                "floors": 5,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/94e4df1d-c1c0-4f9a-b7da-0a08bcb02398.jpg",
                "real": true
        },
        {
                "id": "dfba1ea3-5361-4407-8e58-6c42b84b9a0a",
                "name": "Aletamar",
                "zone": "Playa Grande",
                "address": "Av. del Hotel, Maiquetía 1162, La Guaira, Venezuela",
                "lat": 10.61016,
                "lng": -67.01746,
                "floors": 7,
                "status": "damaged",
                "damage_level": "parcial",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/5bafc373-b380-443b-9f65-ada8159a12bf.png",
                "real": true
        },
        {
                "id": "e22707ab-3079-4287-9ff7-d7dc542da0b2",
                "name": "Playa Verde",
                "zone": "Playa Verde",
                "address": "Playa Verde, Maiquetía, La Guaira, Venezuela",
                "lat": 10.61022,
                "lng": -66.99433,
                "floors": 5,
                "status": "damaged",
                "damage_level": "parcial",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/a9e2d055-b466-4d4b-8d68-93d09c9cd802.jpg",
                "real": true
        },
        {
                "id": "e5b2879a-0138-437f-85b8-52bca7fbb94d",
                "name": "Residencias Montemar",
                "zone": "Catia la Mar",
                "address": "catia la mar av central de, Maiquetía 1162, La Guaira, Venezuela",
                "lat": 10.61182,
                "lng": -67.02358,
                "floors": 9,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/91d93f1c-75ba-463c-9f88-11f55a97d95a.jpg",
                "real": true
        },
        {
                "id": "e8089366-438f-4030-a88e-6661146df218",
                "name": "Kozar",
                "zone": "Catia",
                "address": "Calle Colombia No 15 Al Lado De La Clinica Panamericana, Caracas 1030, Distrito Capital, Venezuela",
                "lat": 10.51128,
                "lng": -66.94775,
                "floors": 7,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/f0614d08-1149-42b5-a006-903aa9b956b6.jpg",
                "real": true
        },
        {
                "id": "f0a364dc-3e5d-4177-8eed-bb660fdbce3b",
                "name": "Oasis Camuri",
                "zone": "Naiguatá",
                "address": "1 Av. Principal de Naiguatá, Naiguatá 1166, La Guaira, Venezuela",
                "lat": 10.61109,
                "lng": -66.71488,
                "floors": 5,
                "status": "damaged",
                "damage_level": "parcial",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/42f06f2e-a96b-4639-9b3d-a3bc8ac030cf.png",
                "real": true
        },
        {
                "id": "f15c9c90-cad2-417a-8e4f-228f18ec4ea3",
                "name": "Costa Dorada",
                "zone": "Playa Grande",
                "address": "JX6H+HW7, Calle 9, Maiquetía 1162, La Guaira, Venezuela",
                "lat": 10.61141,
                "lng": -67.0202,
                "floors": 7,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/3e07a540-e036-4aa6-a572-389b45925dca.jpg",
                "real": true
        },
        {
                "id": "f16bb091-aed0-412a-ae46-edba40b715ab",
                "name": "Caraballeda Country residences Mar.",
                "zone": "Caraballeda",
                "address": "J57C+466, Caraballeda, La Guaira, Venezuela",
                "lat": 10.6114,
                "lng": -66.82948,
                "floors": 8,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/9cb0b22d-0691-4f75-8a59-a3c6275892d1.webp",
                "real": true
        },
        {
                "id": "f7b803d0-812c-4faf-b92a-a22795a54964",
                "name": "URBANISMO HUGO CHAVEZ",
                "zone": "Playa Grande",
                "address": "Playa Grande, Maiquetía 1162, La Guaira, Venezuela",
                "lat": 10.60877,
                "lng": -67.02545,
                "floors": 5,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/eb2ac35e-c10f-413a-98ac-f213b1ac3c5f.jpg",
                "real": true
        },
        {
                "id": "f7b86f08-ba26-4dbd-ab8f-b6ca865bb37d",
                "name": "Urbanismo Cacique Caribe",
                "zone": "Guaracarumbo",
                "address": "Urbanización Urimare, Catia La Mar 1162, La Guaira, Venezuela",
                "lat": 10.59475,
                "lng": -67.01385,
                "floors": 6,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/ba881dfa-887f-4904-b204-8e5e7a30e374.png",
                "real": true
        },
        {
                "id": "fd0260af-8ab8-4b18-91f0-fdbd90316fa4",
                "name": "Residencia Ocean Caraballeda",
                "zone": "Junto a las residencias Palma Real, frente a la Playa Los Cocos",
                "address": "J587+52G, C. La Playa, Caraballeda 1165, La Guaira, Venezuela",
                "lat": 10.61161,
                "lng": -66.83743,
                "floors": 5,
                "status": "damaged",
                "damage_level": "severo",
                "photo": "https://jckifxsdlnsvbztxydes.supabase.co/storage/v1/object/public/damage-media/reports/3bbb81e2-58c0-4a1f-96f6-02c3a30dc79b.jpg",
                "real": true
        }
];

    // Enrich with collapse probabilities and floor validation
    // Known structural floor counts (measured from structural drawings or field surveys)
    const knownFloorBuildings = new Set([
        'OPPPE 26', 'OPPPE 27', 'OPPE 30', 'Hotel Eduard\'s', 'Rita Sol', 'Ritamar', 'Bravamar', 
        'Vallarta', 'Petunia', 'Coral Park', 'Coral Mar', 'Puerto Coral', 'Coral Beach', 
        'Meliá Caribe', 'Punta Brisas', 'Punto Piedra', 'Aguamarina', 'Paseo del Mar', 
        'Aduana de La Guaira', 'Torre Administrativa', 'Cumanaguto', 'Hugo Chávez', 'Oasis Beach', 
        'Mar Azul', 'Cimaventura', 'Belo Horizonte', 'Catia Mar', 'Carmen de Uria', 'Uria Mar'
    ]);

    buildings.forEach(b => {
        // Check if building has an exact known floor count or if it was estimated
        const hasKnownFloors = knownFloorBuildings.has(b.name) || 
                              [...knownFloorBuildings].some(k => b.name.includes(k));
        b.has_real_floors = hasKnownFloors;

        const data = collapseData[b.floors] || collapseData[5];

        if (b.status === 'collapsed') {
            b.p2001 = 100.0;
            b.p2019 = data ? data.p2019 : 63.6;
            b.p2001Str = '100.0%';
            b.p2019Str = `${b.p2019.toFixed(1)}%`;
        } else if (b.status === 'damaged') {
            // Confirmado en pie con daño parcial/severo (NO colapsó)
            if (hasKnownFloors) {
                b.p2001 = Math.min(data ? data.p2001 : 60.0, 75.0);
                b.p2019 = data ? data.p2019 : 40.0;
                b.p2001Str = `${b.p2001.toFixed(1)}%`;
                b.p2019Str = `${b.p2019.toFixed(1)}%`;
            } else {
                // Sin número de pisos especificado en el reporte real: marcar N/D
                b.p2001 = null;
                b.p2019 = null;
                b.p2001Str = 'N/D';
                b.p2019Str = 'N/D';
            }
        } else {
            b.p2001 = data ? data.p2001 : 40.0;
            b.p2019 = data ? data.p2019 : 30.0;
            b.p2001Str = `${b.p2001.toFixed(1)}%`;
            b.p2019Str = `${b.p2019.toFixed(1)}%`;
        }
    });

    // --- Create Leaflet Map ---
    const map = L.map(container, {
        center: [10.6140, -66.8650],
        zoom: 13,
        zoomControl: true,
        attributionControl: true
    });
    damageMapInstance = map;

    // Google Maps Hybrid Satellite Tiles (Satellite imagery + street/place labels)
    L.tileLayer('https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        maxZoom: 20,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
        attribution: 'Map data &copy; Google Maps'
    }).addTo(map);

    // --- Color coding by building status and probability ---
    function getColor(input, norm = currentNorm) {
        if (input === null || input === undefined) return '#ffb703';
        if (typeof input === 'number') {
            const prob = input;
            if (prob >= 100) return '#111111';
            if (prob >= 80)  return '#e63946';
            if (prob >= 60)  return '#fb8500';
            if (prob >= 40)  return '#ffb703';
            return '#2ec4b6';
        }
        if (typeof input === 'object') {
            if (input.status === 'collapsed') return '#111111';
            if (input.status === 'damaged')   return '#fb8500'; // Naranja para estructuras en pie con daño
            if (input.status === 'survived')  return '#2ec4b6';

            const prob = norm === '2001' ? input.p2001 : input.p2019;
            if (prob === null || prob === undefined) return '#fb8500';
            if (prob >= 100) return '#111111';
            if (prob >= 80)  return '#e63946';
            if (prob >= 60)  return '#fb8500';
            if (prob >= 40)  return '#ffb703';
            return '#2ec4b6';
        }
        return '#ffb703';
    }

    function getStatusLabel(b) {
        const buildingStatus = typeof b === 'object' ? b.status : arguments[1];
        if (buildingStatus === 'collapsed') return { text: 'COLAPSÓ', cls: 'popup-status-collapsed', icon: 'fa-house-chimney-crack' };
        if (buildingStatus === 'damaged')   return { text: 'DAÑO SEVERO (EN PIE)', cls: 'popup-status-damaged', icon: 'fa-house-crack' };
        if (buildingStatus === 'survived')  return { text: 'RESISTIÓ', cls: 'popup-status-survived', icon: 'fa-shield-halved' };

        const prob = typeof b === 'object' ? (currentNorm === '2001' ? b.p2001 : b.p2019) : b;
        if (prob === null || prob === undefined) return { text: 'DAÑO SEVERO (EN PIE)', cls: 'popup-status-damaged', icon: 'fa-house-crack' };
        if (prob >= 100) return { text: 'COLAPSÓ', cls: 'popup-status-collapsed', icon: 'fa-house-chimney-crack' };
        if (prob >= 70)  return { text: 'DAÑO SEVERO', cls: 'popup-status-damaged', icon: 'fa-house-crack' };
        if (prob >= 40)  return { text: 'DAÑO MODERADO', cls: 'popup-status-damaged', icon: 'fa-exclamation-triangle' };
        return { text: 'RESISTIÓ', cls: 'popup-status-survived', icon: 'fa-shield-halved' };
    }

    // --- Create markers ---
    let currentNorm = '2001';
    const markers = [];

    function createPopupContent(b) {
        const status = getStatusLabel(b);
        const color = getColor(b);
        const normLabel = currentNorm === '2001' ? 'COVENIN 2001' : 'COVENIN 2019';
        const otherNormLabel = currentNorm === '2001' ? 'COVENIN 2019' : 'COVENIN 2001';

        const probStr = currentNorm === '2001' ? b.p2001Str : b.p2019Str;
        const otherProbStr = currentNorm === '2001' ? b.p2019Str : b.p2001Str;
        const floorsDisplay = b.has_real_floors ? `${b.floors} Pisos` : 'N/D (Reporte Ciudadano)';

        const confirmedBadge = b.real
            ? `<div style="font-size: 9px; color: var(--text-muted); margin-top: 4px; text-align: center;">
                 <i class="fa-solid fa-circle-check" style="color: ${b.status === 'collapsed' ? '#e63946' : '#ffb703'};"></i>
                 Estado real comprobado por reporte
               </div>`
            : '';

        return `
            <div class="popup-building-name">
                <i class="fa-solid fa-building" style="color: ${color};"></i>
                ${b.name}
            </div>
            <div class="popup-row">
                <span class="popup-row-label">Pisos</span>
                <span class="popup-row-value">${floorsDisplay}</span>
            </div>
            <div class="popup-row">
                <span class="popup-row-label">${normLabel}</span>
                <span class="popup-row-value" style="color: ${color};">${probStr}</span>
            </div>
            <div class="popup-row">
                <span class="popup-row-label">${otherNormLabel}</span>
                <span class="popup-row-value" style="color: var(--text-muted);">${otherProbStr}</span>
            </div>
            <div style="text-align: center; margin-top: 6px;">
                <span class="popup-status-badge ${status.cls}">
                    <i class="fa-solid ${status.icon}"></i> ${status.text}
                </span>
            </div>
            ${confirmedBadge}
        `;
    }

    buildings.forEach((b, idx) => {
        const color = getColor(b);
        const isCollapsed = b.status === 'collapsed';

        const marker = L.circleMarker([b.lat, b.lng], {
            radius: isCollapsed ? 10 : 8,
            fillColor: isCollapsed ? '#111111' : color,
            color: isCollapsed ? '#e63946' : 'rgba(255,255,255,0.5)',
            weight: isCollapsed ? 2.5 : 1.5,
            opacity: 1,
            fillOpacity: 0.85,
            className: isCollapsed ? 'pulse-marker-anim' : ''
        });

        marker.bindPopup(createPopupContent(b), {
            className: 'damage-popup',
            maxWidth: 260
        });

        const tooltipFloors = b.has_real_floors ? `${b.floors}P` : 'N/D';
        marker.bindTooltip(`${b.name} (${tooltipFloors})`, {
            direction: 'top',
            offset: [0, -10],
            className: 'damage-tooltip'
        });

        marker.addTo(map);
        markers.push({ marker, building: b, index: idx });
    });

    // --- Norm Toggle ---
    function updateMarkersForNorm(norm) {
        currentNorm = norm;
        markers.forEach(({ marker, building }) => {
            const color = getColor(building);
            const isCollapsed = building.status === 'collapsed';

            marker.setStyle({
                fillColor: isCollapsed ? '#111111' : color,
                color: isCollapsed ? '#e63946' : 'rgba(255,255,255,0.5)',
                weight: isCollapsed ? 2.5 : 1.5,
                radius: isCollapsed ? 10 : 8
            });

            // Update popup content
            marker.setPopupContent(createPopupContent(building));
        });

        // Update table & filters
        applyFilters();
    }

    const toggleContainer = document.getElementById('damage-map-toggle');
    if (toggleContainer) {
        toggleContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('.toggle-btn');
            if (!btn) return;

            toggleContainer.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const norm = btn.getAttribute('data-norm');
            const normLabel = document.getElementById('damage-map-norm-label');
            if (normLabel) {
                const label = norm === '2001'
                    ? 'Mostrando: <strong>Norma COVENIN 1756:2001</strong> (Tradicional)'
                    : 'Mostrando: <strong>Norma COVENIN 1756:2019</strong> (Moderna)';
                normLabel.innerHTML = label;
            }

            updateMarkersForNorm(norm);
        });
    }

    // --- Search & Filter Logic ---
    const searchInput = document.getElementById('damage-map-search');
    const statusSelect = document.getElementById('damage-map-status-filter');
    const countBadge = document.getElementById('damage-map-count-badge');

    function applyFilters() {
        const query = (searchInput ? searchInput.value : '').toLowerCase().trim();
        const selectedStatus = statusSelect ? statusSelect.value : 'all';

        const filtered = buildings.filter(b => {
            // Text search match (name, zone, address)
            const matchText = !query || 
                b.name.toLowerCase().includes(query) || 
                (b.zone && b.zone.toLowerCase().includes(query)) ||
                (b.address && b.address.toLowerCase().includes(query));

            // Status filter match
            let matchStatus = true;
            const prob = currentNorm === '2001' ? b.p2001 : b.p2019;

            if (selectedStatus === 'collapsed') {
                matchStatus = b.status === 'collapsed' || prob >= 100;
            } else if (selectedStatus === 'damaged') {
                matchStatus = b.status === 'damaged' || (prob >= 40 && prob < 100);
            } else if (selectedStatus === 'survived') {
                matchStatus = b.status === 'survived' || prob < 40;
            }

            return matchText && matchStatus;
        });

        // Sync map markers visibility
        const filteredIds = new Set(filtered.map(b => b.id || b.name));
        markers.forEach(({ marker, building }) => {
            const id = building.id || building.name;
            if (filteredIds.has(id)) {
                if (!map.hasLayer(marker)) marker.addTo(map);
            } else {
                map.removeLayer(marker);
            }
        });

        // Update table
        populateTable(currentNorm, filtered);

        // Update count badge
        if (countBadge) {
            countBadge.textContent = `${filtered.length} de ${buildings.length} edificaciones`;
        }
    }

    if (searchInput) {
        searchInput.addEventListener('input', applyFilters);
    }
    if (statusSelect) {
        statusSelect.addEventListener('change', applyFilters);
    }

    // --- Summary Table Rendering ---
    function populateTable(norm, list = buildings) {
        const tbody = document.getElementById('damage-map-table-body');
        if (!tbody) return;

        if (list.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 13px;">
                        <i class="fa-solid fa-building-circle-exclamation" style="font-size: 22px; margin-bottom: 8px; display: block; color: var(--color-2001);"></i>
                        No se encontraron edificaciones que coincidan con la búsqueda o filtro seleccionado.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = list.map((b, i) => {
            const status = getStatusLabel(b);
            const color2001 = getColor(b.p2001 !== null ? b.p2001 : b, '2001');
            const color2019 = getColor(b.p2019 !== null ? b.p2019 : b, '2019');
            const zoneHtml = b.zone ? `<span style="font-size: 11px; color: var(--text-muted); display: block; margin-top: 2px;">📍 ${b.zone}</span>` : '';

            const floorsCell = b.has_real_floors ? `${b.floors}P` : `<span style="color: var(--text-muted); font-size: 11px;" title="Pisos no especificados en el reporte real">N/D</span>`;
            const p2001Cell = b.p2001 !== null ? `${b.p2001.toFixed(1)}%` : `<span style="color: #ffb703; font-size: 11px;" title="Estructura en pie (Daño sin colapso)">N/D</span>`;
            const p2019Cell = b.p2019 !== null ? `${b.p2019.toFixed(1)}%` : `<span style="color: #ffb703; font-size: 11px;" title="Estructura en pie (Daño sin colapso)">N/D</span>`;

            return `
                <tr class="damage-table-row" data-index="${i}" style="transition: background 0.15s ease;">
                    <td class="calc-param-name">${i + 1}</td>
                    <td class="calc-value" style="text-align: left; font-weight: 500;">
                        <span style="font-weight: 600; color: #fff;">${b.name}</span>
                        ${zoneHtml}
                    </td>
                    <td class="calc-value">${floorsCell}</td>
                    <td class="calc-value" style="color: ${b.p2001 !== null ? color2001 : '#ffb703'}; font-weight: 600;">${p2001Cell}</td>
                    <td class="calc-value" style="color: ${b.p2019 !== null ? color2019 : '#ffb703'}; font-weight: 600;">${p2019Cell}</td>
                    <td class="calc-unit">
                        <span class="popup-status-badge ${status.cls}" style="margin: 0; font-size: 9px;">
                            <i class="fa-solid ${status.icon}"></i> ${status.text}
                        </span>
                    </td>
                </tr>
            `;
        }).join('');

        // Click row to center map on building & open popup
        tbody.querySelectorAll('.damage-table-row').forEach((row) => {
            row.style.cursor = 'pointer';
            row.addEventListener('click', () => {
                const idx = parseInt(row.getAttribute('data-index'), 10);
                const b = list[idx];
                if (!b) return;

                map.setView([b.lat, b.lng], 16, { animate: true });
                const targetMarker = markers.find(m => (m.building.id || m.building.name) === (b.id || b.name));
                if (targetMarker) {
                    targetMarker.marker.openPopup();
                }

                // Scroll map smoothly into view if needed
                const mapEl = document.getElementById('damage-map-container');
                if (mapEl) {
                    mapEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            });
        });
    }

    // Initial load
    applyFilters();

    // Fit bounds to show all markers
    const group = L.featureGroup(markers.map(m => m.marker));
    map.fitBounds(group.getBounds().pad(0.1));
}

// --- Floating Feedback Modal & Anti-URL FormSubmit.co Integration ---
function initFeedbackSystem() {
    const triggerBtn = document.getElementById('floating-feedback-btn');
    const modalOverlay = document.getElementById('feedback-modal-overlay');
    const closeBtn = document.getElementById('feedback-modal-close');
    const cancelBtn = document.getElementById('feedback-cancel-btn');
    const form = document.getElementById('feedback-form');
    const messageInput = document.getElementById('fb-message');
    const urlWarning = document.getElementById('fb-url-warning');
    const submitBtn = document.getElementById('feedback-submit-btn');
    const statusMsg = document.getElementById('fb-status-msg');

    if (!triggerBtn || !modalOverlay || !form) return;

    // Open Modal
    triggerBtn.addEventListener('click', () => {
        modalOverlay.classList.add('active');
    });

    // Close Modal
    const closeModal = () => {
        modalOverlay.classList.remove('active');
        if (statusMsg) statusMsg.style.display = 'none';
    };

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeModal();
    });

    // Anti-URL Detection Regex (Detects http, https, www, .com, .net, .org, .co, etc.)
    const urlPattern = /(https?:\/\/|www\.|[a-zA-Z0-9-]+\.(com|net|org|io|gov|edu|co|app|dev|me|site|online|xyz|info|ve|es|uk|de|tk|ga))/i;

    function checkMessageForURLs() {
        const text = messageInput ? messageInput.value : '';
        const containsUrl = urlPattern.test(text);

        if (containsUrl) {
            if (urlWarning) urlWarning.style.display = 'flex';
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.style.opacity = '0.5';
                submitBtn.style.cursor = 'not-allowed';
            }
            return true;
        } else {
            if (urlWarning) urlWarning.style.display = 'none';
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.style.opacity = '1';
                submitBtn.style.cursor = 'pointer';
            }
            return false;
        }
    }

    if (messageInput) {
        messageInput.addEventListener('input', checkMessageForURLs);
    }

    // Form Submission via AJAX to FormSubmit.co
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (checkMessageForURLs()) {
            alert('Por seguridad no se permiten enlaces ni direcciones URL en el mensaje.');
            return;
        }

        const name = document.getElementById('fb-name')?.value || 'Anónimo';
        const email = document.getElementById('fb-email')?.value || 'No provisto';
        const message = messageInput ? messageInput.value : '';

        if (!message.trim()) return;

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando...';

        try {
            const response = await fetch('https://formsubmit.co/ajax/00c51e35972f9569444e92fc37f83cce', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    _subject: 'Nuevo Feedback - VZLA SISMO 3D',
                    _template: 'table',
                    _captcha: 'false',
                    Nombre: name,
                    Correo: email,
                    Mensaje: message,
                    Pagina: window.location.href,
                    Fecha: new Date().toLocaleString()
                })
            });

            const result = await response.json();

            if (response.ok || result.success === 'true' || result.success === true) {
                if (statusMsg) {
                    statusMsg.className = 'fb-status-msg success';
                    statusMsg.innerHTML = '<i class="fa-solid fa-circle-check"></i> ¡Muchas gracias! Tu feedback ha sido enviado con éxito.';
                }
                form.reset();
                if (urlWarning) urlWarning.style.display = 'none';
                setTimeout(() => {
                    closeModal();
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Enviar Feedback';
                    }
                }, 2500);
            } else {
                throw new Error(result.message || 'Error en el servidor de envío');
            }
        } catch (err) {
            console.error('Error al enviar feedback:', err);
            if (statusMsg) {
                statusMsg.className = 'fb-status-msg error';
                statusMsg.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> Ocurrió un error al enviar. Por favor intenta nuevamente.';
            }
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Reintentar Enviar';
            }
        }
    });
}

// Auto-initialize feedback system on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFeedbackSystem);
} else {
    initFeedbackSystem();
}

