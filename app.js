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

// --- INICIALIZACIÓN ---
document.addEventListener("DOMContentLoaded", () => {
    try {
        initUI();
    } catch(e) {
        console.error('[initUI]', e);
    }
    try {
        initThreeJS();
    } catch(e) {
        console.error('[initThreeJS]', e);
        document.getElementById('canvas-3d-container').innerHTML = '<div style="color:red;padding:20px;font-size:12px;">[3D ERROR] ' + e.message + '</div>';
    }
    try {
        generateSpectraAndEarthquake();
    } catch(e) {
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
    } catch(e) {
        console.error('[animate3D]', e);
    }
});


// --- INTERFAZ DE USUARIO (EVENTOS Y TABS) ---
function initUI() {
    // Tab switching
    const tabBtns = document.querySelectorAll(".tab-btn");
    const tabContents = document.querySelectorAll(".tab-content");
    
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
            }
        });
    });

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

    // 2019 Sliders
    setupSlider("covenin19-a0");
    setupSlider("covenin19-a1");

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
        "sismo1-direction", "sismo2-direction", "building-use"
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
}

// --- FÓRMULAS SÍSMICAS COVENIN 1756 ---

// COVENIN 1756:2001
function getSpectrum2001(T, params) {
    const Ao = params.Ao;
    const alpha = params.alpha;
    const phi = params.phi;
    const R = params.R;
    const soil = params.soil; // 'S1', 'S2', 'S3', 'S4'

    // Tabla 7.1: Valores de beta, T* y p
    let beta, T_star, p;
    switch(soil) {
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
        // Tramo ascendente
        Ad = (alpha * phi * Ao) / (1 + (T / T_plus) * (R / beta - 1));
    } else if (T <= T_star) {
        // Meseta
        Ad = (alpha * phi * beta * Ao) / R;
    } else {
        // Rama descendente
        Ad = ((alpha * phi * beta * Ao) / R) * Math.pow(T_star / T, p);
    }

    // Límite inferior de diseño
    const minAd = (alpha * Ao) / R;
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
    const soilClass = params.soilClass; // 'A', 'B', 'BC', 'C', 'D', 'E'

    // Factores de sitio sugeridos según Clase de Sitio (Tablas 8, 9, 10 simplificadas)
    let Fac, Fvc, Fdc, q;
    switch(soilClass) {
        case 'A':  Fac = 0.8; Fvc = 0.8; Fdc = 0.8; q = 1.5; break;
        case 'B':  Fac = 0.9; Fvc = 0.9; Fdc = 0.9; q = 1.5; break;
        case 'BC': Fac = 1.0; Fvc = 1.0; Fdc = 1.0; q = 1.7; break;
        case 'C':  Fac = 1.2; Fvc = 1.4; Fdc = 1.4; q = 1.7; break;
        case 'D':  Fac = 1.5; Fvc = 1.8; Fdc = 1.8; q = 1.9; break;
        case 'E':  Fac = 2.0; Fvc = 2.4; Fdc = 2.4; q = 2.0; break;
        default:   Fac = 1.2; Fvc = 1.4; Fdc = 1.4; q = 1.7;
    }

    // Asumimos factores adicionales H (profundidad) y T (topográfico) unitarios
    const Fa = Fac;
    const Fv = Fvc;
    const Fd = Fdc;

    const AA = Fa * alpha * Ao;
    const AV = Fv * alpha * A1;
    const beta_star = 2.4; // Amplificación espectral elástica típica

    // Periodos característicos
    const TC = 2.4 * (AV / AA);
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
    
    // Generar Ruido Blanco
    let w = [];
    for(let i=0; i<N_steps; i++) {
        // Box-Muller para distribución normal (media 0, varianza 1)
        let u1 = Math.random();
        let u2 = Math.random();
        let randStdNormal = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);
        w.push(randStdNormal);
    }

    // Filtrado de Kanai-Tejimi (representa el filtrado del suelo)
    // Suelo rígido: T_soil ~ 0.4s, Suelo blando: T_soil ~ 1.2s
    const omega_g = (2.0 * Math.PI) / T_soil;
    const zeta_g = 0.6; // amortiguamiento del suelo típico

    // Solución del filtro (1 DOF) mediante Newmark predictor-corrector
    let x_f = 0, v_f = 0, a_f = 0;
    const beta = 0.25, gamma = 0.5;
    
    let filtered = new Array(N_steps).fill(0);
    for(let i=0; i<N_steps; i++) {
        // Predictores
        let x_pred = x_f + dt * v_f + dt*dt * (0.5 - beta) * a_f;
        let v_pred = v_f + dt * (1.0 - gamma) * a_f;

        // Fuerza externa es el ruido blanco
        let force = w[i];

        // Aceleración correctora
        // m*a + c*v + k*x = f => a_new = f - 2*zeta*omega*v_pred - omega^2*x_pred
        let a_new = force - 2.0 * zeta_g * omega_g * v_pred - omega_g*omega_g * x_pred;

        // Corrección
        x_f = x_pred + beta * dt*dt * a_new;
        v_f = v_pred + gamma * dt * a_new;
        a_f = a_new;

        // Aceleración en superficie: a_g = 2*zeta_g*omega_g*v_f + omega_g^2*x_f
        filtered[i] = 2.0 * zeta_g * omega_g * v_f + omega_g*omega_g * x_f;
    }

    // Normalizar la señal filtrada
    let maxVal = Math.max(...filtered.map(Math.abs));
    if (maxVal > 0) {
        filtered = filtered.map(val => val / maxVal);
    }

    // Modulación mediante envolventes de Jennings
    // Sismo 1: t = 0 a 30s
    // Sismo 2: t = 40 a 70s
    for(let i=0; i<N_steps; i++) {
        let t = i * dt;
        let env1 = 0;
        let env2 = 0;

        // Envolvente Sismo 1
        if (t >= 0 && t < 30) {
            let t1 = 2.0; // rampa de subida
            let t2 = 10.0; // meseta
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

        // Combinar sismos multiplicados por su respectivo PGA (en g)
        groundAccel[i] = (filtered[i] * env1 * pga1) + (filtered[i] * env2 * pga2);
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

        this.m = this.m_ref * (0.3 + 0.7 * (area / 25.0));

        const CONV = 98066.5;
        const ES_PA = 2.0e6 * CONV;

        if (customSections && customSections.enable) {
            const fc_col  = customSections.fcCol;
            const fc_beam = customSections.fcBeam;
            const Ec_col  = 15100.0 * Math.sqrt(fc_col)  * CONV;
            const Ec_beam = 15100.0 * Math.sqrt(fc_beam) * CONV;

            const bc_x = customSections.colWidth  / 100;
            const hc_x = customSections.colDepth  / 100;
            const Ic_gross_x = (bc_x * Math.pow(hc_x, 3)) / 12;
            
            const n_col = ES_PA / Ec_col;
            const As_col_m2 = (customSections.colAs) / 1e4;
            const d_cover_col = 0.04;
            const arm_col_x = hc_x / 2 - d_cover_col;
            const Ic_x = Ic_gross_x + (n_col - 1) * As_col_m2 * arm_col_x * arm_col_x;

            const n = ES_PA / Ec_beam;
            const As_m2  = (customSections.beamAs)      / 1e4;
            const Asp_m2 = (customSections.beamAsPrime)  / 1e4;
            const d_cover = 0.04;
            const d  = (customSections.beamDepth / 100) - d_cover;
            const dp = d_cover;

            const A_quad = (customSections.beamWidth / 100) / 2;
            const B_quad = n * (As_m2 + Asp_m2);
            const C_quad = -n * (As_m2 * d + Asp_m2 * dp);
            const discriminant = B_quad * B_quad - 4 * A_quad * C_quad;
            const x_na = (-B_quad + Math.sqrt(Math.max(0, discriminant))) / (2 * A_quad);

            const Icr = ((customSections.beamWidth / 100) * Math.pow(x_na, 3)) / 3
                       + n * Asp_m2 * Math.pow(Math.max(0, x_na - dp), 2)
                       + n * As_m2  * Math.pow(Math.max(0, d - x_na), 2);

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
        this.isCollapsed = false;
        this.collapseTime = null;
        this.maxDriftRatio = 0;

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
        for(let i=0; i<N; i++) {
            x_pred[i] = x_old[i] + dt * v_old[i] + dt2 * (0.5 - beta) * a_old[i];
            v_pred[i] = v_old[i] + dt * (1.0 - gamma) * a_old[i];
        }

        const storyForces = new Array(N);
        for(let i=0; i<N; i++) {
            const x_i = x_pred[i];
            const x_prev = (i === 0) ? 0 : x_pred[i-1];
            const u = x_i - x_prev;
            const up = this.u_p[i];
            
            const k_init_floor_i = isX ? this.k_init_x : this.k_init_y;
            const vy_init_floor_i = isX ? this.Vy_init_x[i] : this.Vy_init_y[i];

            const k_deg_factor  = 1.0 - (0.6 * this.effDegSeverity * this.D[i]);
            const vy_deg_factor = 1.0 - (0.4 * this.effDegSeverity * this.D[i]);

            this.k[i]  = k_init_floor_i  * Math.max(0.05, k_deg_factor);
            this.Vy[i] = vy_init_floor_i * Math.max(0.1,  vy_deg_factor);

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
            this.u_max[i] = Math.max(this.u_max[i], Math.abs(u) * torsionAmp_curr);

            const u_ult = this.driftCollapseLimit * this.h;
            const beta_daño = 0.05 * this.effDegSeverity;
            this.D[i] = (this.u_max[i] / u_ult) + (beta_daño * this.E_h[i]) / (vy_init_floor_i * u_ult);
            this.D[i] = Math.min(1.0, Math.max(0.0, this.D[i]));

            const driftRatio = (Math.abs(u) * torsionAmp_curr) / this.h;
            if (driftRatio > this.driftCollapseLimit || this.D[i] >= 0.99) {
                this.isCollapsed = true;
                this.collapseTime = currentTime;
            }
        }

        const f_rest = new Array(N);
        for(let i=0; i<N; i++) {
            f_rest[i] = storyForces[i] - ((i === N-1) ? 0 : storyForces[i+1]);
        }

        const f_damp = new Array(N).fill(0);
        for(let i=0; i<N; i++) {
            const v_i = v_pred[i];
            const v_prev = (i === 0) ? 0 : v_pred[i-1];
            const v_next = (i === N-1) ? 0 : v_pred[i+1];
            const k_i = this.k[i];
            const k_next = (i === N-1) ? 0 : this.k[i+1];
            f_damp[i] = this.aM * this.m * v_i + this.aK * (k_i * (v_i - v_prev) - k_next * (v_next - v_i));
        }

        const a_new = new Array(N);
        for(let i=0; i<N; i++) a_new[i] = -a_ground * G - (f_damp[i] + f_rest[i]) / this.m;

        for(let i=0; i<N; i++) {
            this.x[i] = x_pred[i] + beta * dt2 * a_new[i];
            this.v[i] = v_pred[i] + gamma * dt * a_new[i];
            this.a[i] = a_new[i];
            const u_curr = this.x[i] - ((i === 0) ? 0 : this.x[i-1]);
            const driftRatio = (Math.abs(u_curr) * torsionAmp_curr) / this.h;
            if (driftRatio > this.maxDriftRatio) this.maxDriftRatio = driftRatio;
        }

        this.history.time.push(currentTime);
        this.history.roofDisp.push(this.x[N-1]);
        this.history.groundDrift.push(this.x[0] / this.h);
        this.history.groundShear.push(storyForces[0]);
    }
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
        fcCol:     parseFloat(document.getElementById("concrete-fc-col").value) || 250,
        fcBeam:    parseFloat(document.getElementById("concrete-fc-beam").value) || 250,
        fyCol:     parseFloat(document.getElementById("steel-fy-col").value) || 4200,
        fyBeam:    parseFloat(document.getElementById("steel-fy-beam").value) || 4200,
        colAs:     parseFloat(document.getElementById("col-as").value) || 16,
        beamAs:      parseFloat(document.getElementById("beam-as").value) || 12,
        beamAsPrime: parseFloat(document.getElementById("beam-as-prime").value) || 6
    };

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

    let reportHTML = loadsReportHTML;

    // Leer direcciones de los sismos
    const sismo1Dir = document.getElementById("sismo1-direction").value;
    const sismo2Dir = document.getElementById("sismo2-direction").value;

    if (customSections.enable) {
        // Calcular T1 usando la inercia agrietada transformada de las vigas
        const CONV = 98066.5; // 1 kgf/cm² = 98066.5 Pa
        const ES_PA = 2.0e6 * CONV; // Módulo del acero en Pa
        const Ec_col_Pa  = 15100.0 * Math.sqrt(customSections.fcCol)  * CONV;
        const Ec_beam_Pa = 15100.0 * Math.sqrt(customSections.fcBeam) * CONV;

        const bc_x = customSections.colWidth  / 100; // m
        const hc_x = customSections.colDepth  / 100; // m
        const bc_y = hc_x;
        const hc_y = bc_x;

        const bb = customSections.beamWidth / 100; // m
        const hb = customSections.beamDepth / 100; // m

        // Inercia bruta y transformada de la columna con acero longitudinal - Eje X
        const Ic_gross_x = (bc_x * Math.pow(hc_x, 3)) / 12;
        const n_col_g   = ES_PA / Ec_col_Pa;
        const As_col_m2_g = (customSections.colAs) / 1e4;
        const arm_col_g_x   = hc_x / 2 - 0.04; // recubrimiento 4 cm
        const Ic_x = Ic_gross_x + (n_col_g - 1) * As_col_m2_g * arm_col_g_x * arm_col_g_x;

        // Inercia bruta y transformada de la columna con acero longitudinal - Eje Y
        const Ic_gross_y = (bc_y * Math.pow(hc_y, 3)) / 12;
        const arm_col_g_y   = hc_y / 2 - 0.04;
        const Ic_y = Ic_gross_y + (n_col_g - 1) * As_col_m2_g * arm_col_g_y * arm_col_g_y;

        // Relación modular y áreas de acero en m² para vigas
        const n_mod  = ES_PA / Ec_beam_Pa;
        const As_m2  = customSections.beamAs      / 1e4;
        const Asp_m2 = customSections.beamAsPrime  / 1e4;
        const d_cover = 0.04; // recubrimiento 4 cm
        const d  = hb - d_cover;
        const dp = d_cover;

        // Eje neutro agrietado (cuadrática)
        const A_q = bb / 2;
        const B_q = n_mod * (As_m2 + Asp_m2);
        const C_q = -n_mod * (As_m2 * d + Asp_m2 * dp);
        const x_na = (-B_q + Math.sqrt(Math.max(0, B_q*B_q - 4*A_q*C_q))) / (2 * A_q);

        const Icr = (bb * Math.pow(x_na, 3)) / 3
                  + n_mod * Asp_m2 * Math.pow(Math.max(0, x_na - dp), 2)
                  + n_mod * As_m2  * Math.pow(Math.max(0, d - x_na), 2);

        // Rigidez de columnas y flexibilidad en X
        const k_col_fixed_x = (12.0 * Ec_col_Pa * Ic_x) / Math.pow(storyHeight, 3);
        const kappa_x = (Ec_beam_Pa * Icr * storyHeight) / (2.0 * Ec_col_Pa * Ic_x * sX);
        const eta_x   = (12.0 * kappa_x + 1.0) / (12.0 * kappa_x + 4.0);
        const k_init_custom_x = numCols * k_col_fixed_x * eta_x;

        // Rigidez de columnas y flexibilidad en Y
        const k_col_fixed_y = (12.0 * Ec_col_Pa * Ic_y) / Math.pow(storyHeight, 3);
        const kappa_y = (Ec_beam_Pa * Icr * storyHeight) / (2.0 * Ec_col_Pa * Ic_y * sY);
        const eta_y   = (12.0 * kappa_y + 1.0) / (12.0 * kappa_y + 4.0);
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

    // --- 1. Calcular Parámetros de Diseño COVENIN 2001 ---
    const z01 = parseInt(document.getElementById("covenin01-zone").value);
    let Ao01 = 0.30;
    switch(z01) {
        case 7: Ao01 = 0.40; break;
        case 6: Ao01 = 0.35; break;
        case 5: Ao01 = 0.30; break;
        case 4: Ao01 = 0.25; break;
        case 3: Ao01 = 0.20; break;
        case 2: Ao01 = 0.15; break;
        case 1: Ao01 = 0.10; break;
    }
    const params01 = {
        Ao: Ao01,
        alpha: parseFloat(document.getElementById("covenin01-importance").value),
        phi: 1.0, // Factor de corrección elástico usualmente 1.0 en roca/suelos firmes
        R: parseFloat(document.getElementById("covenin01-r").value),
        soil: document.getElementById("covenin01-soil").value
    };
    
    // Obtener ordenada de diseño para el edificio 2001 en su periodo fundamental real de la dirección del sismo 1
    const T1_design_2001 = (sismo1Dir === 'X') ? T1_actual_x : T1_actual_y;
    const designAd2001 = getSpectrum2001(T1_design_2001, params01);

    // --- 2. Calcular Parámetros de Diseño COVENIN 2019 ---
    const params19 = {
        Ao: parseFloat(document.getElementById("covenin19-a0").value),
        A1: parseFloat(document.getElementById("covenin19-a1").value),
        TL: 4.0, // valor típico sugerido
        alpha: 1.0, // residencial
        R: parseFloat(document.getElementById("covenin19-r").value),
        rho: parseFloat(document.getElementById("covenin19-rho").value),
        Fi: parseFloat(document.getElementById("covenin19-fi").value),
        soilClass: document.getElementById("covenin19-soil-class").value
    };
    
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
    switch(params01.soil) {
        case 'S1': T_soil = 0.4; break;
        case 'S2': T_soil = 0.7; break;
        case 'S3': T_soil = 1.0; break;
        case 'S4': T_soil = 1.3; break;
    }
    
    // PGAs: Sismo 1 (M7.1) = Ao01 * g (ej. 0.30g). Sismo 2 (M7.5) = 1.5 * PGA1 (ej. 0.45g)
    const pga1 = params19.Ao; // usamos Ao en roca de 2019 para calibrar la aceleración base (ej. 0.30g)
    const pga2 = pga1 * 1.5; // M7.5 es más fuerte
    const hasSecond = document.getElementById("double-earthquake").checked;

    generateSyntheticEarthquake(T_soil, pga1, pga2, hasSecond);

    // Llenar el vector de tiempos
    timeSeries = [];
    for(let i=0; i<groundAccel.length; i++) {
        timeSeries.push((i * dt).toFixed(2));
    }

    // --- 5. Dibujar los Espectros en el Tab de Gráficos ---
    drawSpectraChart(params01, params19, T1_actual_x, T1_actual_y);

    // Inyectar el reporte de cálculos dinámicamente en el DOM
    const reportDiv = document.getElementById("calculation-report");
    if (reportDiv) {
        reportDiv.innerHTML = reportHTML;
    }
    
    // Inicializar o limpiar gráficos de respuesta
    resetChartsData();

    // Actualizar visualización 3D estructural (reconstruir edificios con número correcto de pisos)
    rebuild3DStructures();
}

// --- GRÁFICOS CON CHART.JS ---
function drawSpectraChart(p01, p19, T_fund_x, T_fund_y) {
    const ctx = document.getElementById("spectra-chart").getContext("2d");
    
    // Generar datos para las curvas
    const periods = [];
    const data2001 = [];
    const data2019 = [];
    
    for (let t = 0.01; t <= 4.0; t += 0.02) {
        periods.push(t.toFixed(2));
        data2001.push(getSpectrum2001(t, p01));
        data2019.push(getSpectrum2019(t, p19));
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
                    const targetVal = T_val.toFixed(2);
                    const xPos = xAxis.getPixelForValue(targetVal);
                    
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
            labels: periods,
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
                    title: { display: true, text: 'Período de Vibración T (s)', color: '#94a3b8' },
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#94a3b8', maxTicksLimit: 15 }
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

    // Partículas de polvo/humo
    initParticles();

    // Evento resize
    window.addEventListener("resize", () => {
        const width = container.clientWidth;
        const height = container.clientHeight;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
    });
}

function initParticles() {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particlesCount * 3);
    const colors = new Float32Array(particlesCount * 3);

    for (let i = 0; i < particlesCount; i++) {
        // Inicializar fuera de escena
        positions[i*3] = 0;
        positions[i*3+1] = -100;
        positions[i*3+2] = 0;

        colors[i*3] = 0.6;
        colors[i*3+1] = 0.6;
        colors[i*3+2] = 0.6;

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
            positions[i*3] = x + (Math.random() - 0.5) * 3;
            positions[i*3+1] = y + (Math.random() - 0.5) * 0.5;
            positions[i*3+2] = z + (Math.random() - 0.5) * 3;

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
            positions[i*3] += particlesData[i].velocity.x * 0.016;
            positions[i*3+1] += particlesData[i].velocity.y * 0.016;
            positions[i*3+2] += particlesData[i].velocity.z * 0.016;

            // Desaceleración y gravedad leve
            particlesData[i].velocity.y -= 0.1 * 0.016;
            particlesData[i].velocity.x *= 0.98;
            particlesData[i].velocity.z *= 0.98;

            particlesData[i].life -= 1;
            
            if (particlesData[i].life <= 0) {
                positions[i*3+1] = -100; // mover abajo
            }
        }
    }
    particleSystem.geometry.attributes.position.needsUpdate = true;
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

        // Crear columnas de entrepiso dinámicas
        const colOffsets = [];
        for (let ix = 0; ix < numColsX; ix++) {
            const x = numColsX > 1 ? -bW/2 + (ix / (numColsX - 1)) * bW : 0;
            for (let iy = 0; iy < numColsY; iy++) {
                const z = numColsY > 1 ? -bD/2 + (iy / (numColsY - 1)) * bD : 0;
                colOffsets.push({ x: x, z: z });
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

        // Columnas
        for (let lvl = 0; lvl < N; lvl++) {
            const storyCols = [];
            for (let c = 0; c < totalColsPerStory; c++) {
                const colGeom = new THREE.BoxGeometry(colW, h, colD);
                
                // Material inicial seguro (Verde)
                const colMat = new THREE.MeshStandardMaterial({
                    color: varToHexColor('--color-safe'),
                    roughness: 0.4
                });

                const colMesh = new THREE.Mesh(colGeom, colMat);
                colMesh.castShadow = true;
                colMesh.receiveShadow = true;
                
                // Posicionar a la mitad de la altura de la planta
                colMesh.position.set(colOffsets[c].x, (lvl + 0.5) * h, colOffsets[c].z);
                
                bData.group.add(colMesh);
                storyCols.push({
                    mesh: colMesh,
                    offsetX: colOffsets[c].x,
                    offsetZ: colOffsets[c].z,
                    level: lvl
                });
            }
            bData.columns.push(storyCols);
        }

        // Crear vigas longitudinales (eje X)
        if (numColsX > 1) {
            const beamGeomX = new THREE.BoxGeometry(sX, beamH, beamW); // longitud, peralte, ancho
            const beamMat = new THREE.MeshStandardMaterial({
                color: colorTheme === '2001' ? 0x273549 : 0x182030,
                roughness: 0.6
            });

            for (let lvl = 0; lvl < N; lvl++) {
                const floorMesh = bData.floors[lvl];
                for (let iy = 0; iy < numColsY; iy++) {
                    const z = numColsY > 1 ? -bD/2 + (iy / (numColsY - 1)) * bD : 0;
                    for (let ix = 0; ix < numColsX - 1; ix++) {
                        const xStart = -bW/2 + (ix / (numColsX - 1)) * bW;
                        const xEnd = -bW/2 + ((ix + 1) / (numColsX - 1)) * bW;
                        const xCenter = (xStart + xEnd) / 2;

                        const beamMesh = new THREE.Mesh(beamGeomX, beamMat);
                        // Posicionar relativa a la losa (su centro Y está en (lvl+1)*h, Z en 0, X en 0)
                        beamMesh.position.set(xCenter, -0.1 - beamH / 2, z); // 0.1 es la mitad del espesor de la losa (0.2)
                        beamMesh.castShadow = true;
                        beamMesh.receiveShadow = true;
                        floorMesh.add(beamMesh);
                    }
                }
            }
        }

        // Crear vigas transversales (eje Y)
        if (numColsY > 1) {
            const beamGeomY = new THREE.BoxGeometry(beamW, beamH, sY); // ancho, peralte, longitud
            const beamMat = new THREE.MeshStandardMaterial({
                color: colorTheme === '2001' ? 0x273549 : 0x182030,
                roughness: 0.6
            });

            for (let lvl = 0; lvl < N; lvl++) {
                const floorMesh = bData.floors[lvl];
                for (let ix = 0; ix < numColsX; ix++) {
                    const x = numColsX > 1 ? -bW/2 + (ix / (numColsX - 1)) * bW : 0;
                    for (let iy = 0; iy < numColsY - 1; iy++) {
                        const zStart = -bD/2 + (iy / (numColsY - 1)) * bD;
                        const zEnd = -bD/2 + ((iy + 1) / (numColsY - 1)) * bD;
                        const zCenter = (zStart + zEnd) / 2;

                        const beamMesh = new THREE.Mesh(beamGeomY, beamMat);
                        // Posicionar relativa a la losa
                        beamMesh.position.set(x, -0.1 - beamH / 2, zCenter);
                        beamMesh.castShadow = true;
                        beamMesh.receiveShadow = true;
                        floorMesh.add(beamMesh);
                    }
                }
            }
        }
    };

    buildBuilding(buildings3D.b2001, '2001');
    buildBuilding(buildings3D.b2019, '2019');
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
}

function updateBuilding3DPhysics(bModel, b3D, initialX, groundDisp, activeDir) {
    const N = bModel.N;
    const h = bModel.h;
    const isX = (activeDir === 'X');

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
            if (bModel.D[i] > maxD) {
                maxD = bModel.D[i];
                failedLevel = i;
            }
        }

        // Simular caída libre para todas las losas por encima del piso fallado
        for (let lvl = failedLevel; lvl < N; lvl++) {
            const floorMesh = b3D.floors[lvl];
            
            // Destino de caída es la losa inferior
            const targetY = (lvl === 0) ? 0.1 : b3D.floors[lvl-1].position.y + 0.15;
            
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
                col.mesh.scale.y = Math.max(0.1, col.mesh.scale.y - 0.05);
                col.mesh.rotation.z += (col.offsetX > 0 ? 0.03 : -0.03);
                col.mesh.material.color.setHex(0x111111); // Negro de escombros quemados/destruidos
            });
        }
        return;
    }

    // Parámetros geométricos para torsión
    const ecc = parseFloat(document.getElementById("torsional-eccentricity").value) || 0.0;
    const numColsX = parseInt(document.getElementById("num-cols-x").value) || 2;
    const numColsY = parseInt(document.getElementById("num-cols-y").value) || 2;
    const sX = parseFloat(document.getElementById("col-dist-x").value) || 5.0;
    const sY = parseFloat(document.getElementById("col-dist-y").value) || 5.0;
    const bW = sX * (numColsX - 1);
    const bD = sY * (numColsY - 1);
    const rp = Math.sqrt((bW * bW + bD * bD) / 12) || 2.0;

    // Comportamiento normal (oscilación lateral + torsión)
    for (let lvl = 0; lvl < N; lvl++) {
        // Desplazamiento del nivel actual
        const d_curr = bModel.x[lvl] * 6.0; // amplificado para visibilidad en 3D
        const d_prev = (lvl === 0) ? 0 : bModel.x[lvl-1] * 6.0;

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

            // Calcular derivas reales (físicas, no amplificadas) de esta columna particular
            const theta_curr_phys = (bModel.x[lvl] * ecc) / rp;
            const theta_prev_phys = (lvl === 0) ? 0 : (bModel.x[lvl-1] * ecc) / rp;

            const x_trans_p_phys = isX ? (lvl === 0 ? 0 : bModel.x[lvl-1]) : 0;
            const z_trans_p_phys = isX ? 0 : (lvl === 0 ? 0 : bModel.x[lvl-1]);
            const x_trans_c_phys = isX ? bModel.x[lvl] : 0;
            const z_trans_c_phys = isX ? 0 : bModel.x[lvl];

            const x_b_phys = x_trans_p_phys + ox * Math.cos(theta_prev_phys) - oz * Math.sin(theta_prev_phys);
            const z_b_phys = z_trans_p_phys + ox * Math.sin(theta_prev_phys) + oz * Math.cos(theta_prev_phys);

            const x_t_phys = x_trans_c_phys + ox * Math.cos(theta_curr_phys) - oz * Math.sin(theta_curr_phys);
            const z_t_phys = z_trans_c_phys + ox * Math.sin(theta_curr_phys) + oz * Math.cos(theta_curr_phys);

            const drift_x_phys = x_t_phys - x_b_phys;
            const drift_z_phys = z_t_phys - z_b_phys;
            const colDriftRatio = Math.sqrt(drift_x_phys * drift_x_phys + drift_z_phys * drift_z_phys) / h;

            // Determinar color de esta columna según su propia deriva (torsión castiga unas columnas más que otras)
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

            col.mesh.material.color.setHex(colColor);

            // Posicionar columna en el punto medio deformado
            col.mesh.position.set(
                (x_bottom + x_top) / 2,
                (lvl + 0.5) * h,
                (z_bottom + z_top) / 2
            );

            // Orientar la columna a lo largo del tramo deformado (sway en X y Z)
            const dx = x_top - x_bottom;
            const dz = z_top - z_bottom;
            col.mesh.rotation.z = -Math.atan2(dx, h);
            col.mesh.rotation.x = Math.atan2(dz, h);
            col.mesh.rotation.y = (theta_prev + theta_curr) / 2;
        });
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
    
    if (!isPlaying) {
        // INICIAR
        isPlaying = true;
        isPaused = false;
        btnRun.innerHTML = '<i class="fa-solid fa-stop"></i> Detener';
        btnRun.classList.replace("btn-primary", "btn-danger");
        btnPause.disabled = false;
        document.getElementById("btn-reset").disabled = true;
        
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
    
    toggleInputControls(false);
}

function pauseSimulation() {
    const btnPause = document.getElementById("btn-pause");
    if (!isPaused) {
        // PAUSAR
        isPaused = true;
        clearInterval(simInterval);
        btnPause.innerHTML = '<i class="fa-solid fa-play"></i> Reanudar';
    } else {
        // REANUDAR
        isPaused = false;
        btnPause.innerHTML = '<i class="fa-solid fa-pause"></i> Pausar';
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
        "auto-mass", "building-use", "slab-thickness", "extra-dead-load"
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
    
    const damage1 = (Math.max(...eq2001.D) * 100).toFixed(1) + "%";
    document.getElementById("damage-2001").textContent = damage1;

    const status1 = document.getElementById("status-2001");
    if (eq2001.isCollapsed) {
        status1.textContent = "¡COLAPSO!";
        status1.className = "metric-status status-collapsed";
    } else {
        const maxD = Math.max(...eq2001.D);
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

    // Métricas del Edificio 2019
    const drift2 = (eq2019.maxDriftRatio * 100).toFixed(2) + "%";
    document.getElementById("drift-2019").textContent = drift2;
    
    const damage2 = (Math.max(...eq2019.D) * 100).toFixed(1) + "%";
    document.getElementById("damage-2019").textContent = damage2;

    const status2 = document.getElementById("status-2019");
    if (eq2019.isCollapsed) {
        status2.textContent = "¡COLAPSO!";
        status2.className = "metric-status status-collapsed";
    } else {
        const maxD = Math.max(...eq2019.D);
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
}
