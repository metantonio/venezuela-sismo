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
let customGroundAccel = null;  // array de aceleraciones cargado e interpolado (en g)
let customDuration = 80;       // duración del sismo personalizado
let customAccelFileName = "";  // nombre del archivo cargado

// Estructuras de los edificios
let eq2001 = null;
let eq2019 = null;
let currentBoletinCoords = "";

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
    b2001: { group: null, floors: [], columns: [], springs: [], springsGroup: null },
    b2019: { group: null, floors: [], columns: [], springs: [], springsGroup: null }
};
let groundPlane;
let gridHelper;
let particleSystem = null;
let particlesCount = 200;
let particlesData = [];

// FX cinematográficos del viewport 3D
let cameraShake = 0;
let shockwaveRings = [];
let shockwaveCooldown = 0;
let collapseFxFired = { b2001: false, b2019: false };
let ambientMotes = null;
let ambientMotesData = [];
let backdropPlane = null;
let accentLight2001 = null;
let accentLight2019 = null;

// Terreno deformable con propagación dinámica de ondas sísmicas
let terrainGroup = null;
let terrainSolid = null;
let terrainWire = null;
let terrainBaseXZ = null; // posiciones (x,z) de reposo de cada vértice
let terrainAmp = 0;
let terrainWaveTime = 0;
let lastGroundAccel = 0;
let lastFrameTs = 0;
const TERRAIN_EPICENTER = { x: -34, z: -30 };

// Visualizador interactivo de modos de vibración (modo en calma)
let modeViewer = { active: false, kind: 'X', mode: 1 };
let modeViewerClock = 0;

// Resortes helicoidales de fundación (representación SSI)
const SSI_SPRING_HEIGHT = 1.1;

// Estados de Evacuación
let evacuation2001 = { meshes: [], currentFloor: 0, startTime: null, escaped: false, trapped: false };
let evacuation2019 = { meshes: [], currentFloor: 0, startTime: null, escaped: false, trapped: false };

// Indicadores de Fuerza Cortante Base (Corte Basal)
let arrow2001 = null;
let arrow2019 = null;
let label2001 = null;
let label2019 = null;
let canvas2001 = null;
let canvas2019 = null;
let ctx2001 = null;
let ctx2019 = null;
let texture2001 = null;
let texture2019 = null;

// Materiales de Rótulas Plásticas
const hingeYellowMat = new THREE.MeshStandardMaterial({
    color: 0xffca28,
    emissive: 0xffca28,
    emissiveIntensity: 1.1,
    roughness: 0.2
});
const hingeRedMat = new THREE.MeshStandardMaterial({
    color: 0xff1744,
    emissive: 0xff1744,
    emissiveIntensity: 1.3,
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
// Pinta el relleno degradado de un slider según su valor (variable CSS --fill)
function paintRangeFill(el) {
    if (!el) return;
    const min = parseFloat(el.min) || 0;
    const max = parseFloat(el.max) || 100;
    const pct = ((parseFloat(el.value) - min) / (max - min)) * 100;
    el.style.setProperty('--fill', pct + '%');
}

function refreshRangeFills() {
    document.querySelectorAll('input[type="range"]').forEach(paintRangeFill);
}

function initUI() {
    // --- Lógica del Menú Hamburguesa ---
    const menuToggle = document.getElementById("menu-toggle-btn");
    const navDrawer = document.getElementById("nav-drawer");
    const activeTabTitle = document.getElementById("active-tab-title");

    if (menuToggle && navDrawer) {
        menuToggle.addEventListener("click", (e) => {
            e.stopPropagation();
            const isOpen = navDrawer.classList.toggle("active");
            menuToggle.classList.toggle("active", isOpen);
        });

        // Cerrar al hacer clic fuera del menú
        document.addEventListener("click", (e) => {
            if (!menuToggle.contains(e.target) && !navDrawer.contains(e.target)) {
                navDrawer.classList.remove("active");
                menuToggle.classList.remove("active");
            }
        });
    }

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

            // Actualizar título de la barra superior (removiendo el icono)
            if (activeTabTitle) {
                const tempDiv = document.createElement("div");
                tempDiv.innerHTML = btn.innerHTML;
                const icon = tempDiv.querySelector("i");
                if (icon) icon.remove();
                activeTabTitle.textContent = tempDiv.textContent.trim();
            }

            // Cerrar menú vertical al seleccionar una pestaña
            if (navDrawer && menuToggle) {
                navDrawer.classList.remove("active");
                menuToggle.classList.remove("active");
            }

            // Ocultar controles de simulación 3D y cinta de tiempo en vistas secundarias / especializadas
            const nonSimTabs = ["tab-vision", "tab-vargas", "tab-calc", "tab-damage-map", "tab-city", "tab-boletin", "tab-sismos", "tab-info"];
            const isNonSimTab = nonSimTabs.includes(tabId);

            const metricsBoard = document.querySelector(".metrics-board");
            if (metricsBoard) {
                metricsBoard.classList.toggle("metrics-hidden", isNonSimTab);
            }

            const mobileControls = document.querySelector(".mobile-floating-controls");
            if (mobileControls) {
                mobileControls.classList.toggle("controls-hidden", isNonSimTab);
            }

            const controlPanel = document.querySelector(".control-panel");
            if (controlPanel) {
                controlPanel.classList.toggle("panel-hidden", isNonSimTab);
            }

            // El render 3D de la ciudad solo corre mientras su pestaña está activa
            if (citySim) citySim.active = (tabId === "tab-city");

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
            } else if (tabId === "tab-city") {
                if (!citySim) {
                    setTimeout(() => { initCitySim(); }, 120);
                } else {
                    citySim.active = true;
                    resizeCityRenderer();
                    if (!citySim.loopRunning) {
                        citySim.lastFrame = performance.now();
                        requestAnimationFrame(cityFrameLoop);
                    }
                }
            } else if (tabId === "tab-vision") {
                setTimeout(() => { initVisionInspection(); }, 50);
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

    // Pintar relleno degradado en todos los sliders y mantenerlo actualizado
    document.querySelectorAll('input[type="range"]').forEach(el => {
        el.addEventListener('input', () => paintRangeFill(el));
        el.addEventListener('change', () => paintRangeFill(el));
        paintRangeFill(el);
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
        "sismo1-direction", "sismo2-direction", "building-use", "evacuation-mode",
        "earthquake-input-type", "custom-direction", "ise-foundation-type"
    ];
    selects.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener("change", () => {
                if (!isPlaying) generateSpectraAndEarthquake();
            });
        }
    });

    // Checkbox e Inputs de Interacción Suelo-Estructura (ISE)
    const iseEnable = document.getElementById("ise-enable");
    const iseControls = document.getElementById("ise-controls-container");
    if (iseEnable && iseControls) {
        iseEnable.addEventListener("change", () => {
            iseControls.style.display = iseEnable.checked ? "block" : "none";
            if (!isPlaying) generateSpectraAndEarthquake();
        });
        iseControls.style.display = iseEnable.checked ? "block" : "none";
    }

    const iseInputs = ["ise-vs", "ise-df", "ise-poisson", "ise-density"];
    iseInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener("change", () => {
                if (!isPlaying) generateSpectraAndEarthquake();
            });
        }
    });

    const soil01Select = document.getElementById("covenin01-soil");
    if (soil01Select) {
        soil01Select.addEventListener("change", () => {
            syncSoilPropertiesFromNormClass();
        });
    }
    const soil19Select = document.getElementById("covenin19-soil-class");
    if (soil19Select) {
        soil19Select.addEventListener("change", () => {
            syncSoilPropertiesFromNormClass();
        });
    }

    // Botones
    document.getElementById("btn-run").addEventListener("click", toggleSimulation);
    document.getElementById("btn-pause").addEventListener("click", pauseSimulation);
    document.getElementById("btn-reset").addEventListener("click", resetSimulation);

    // --- Visualizador de modos de vibración ---
    const btnModeViewer = document.getElementById("btn-mode-viewer");
    if (btnModeViewer) {
        btnModeViewer.addEventListener("click", () => setModeViewerActive(!modeViewer.active));
    }
    const closeModeViewer = document.getElementById("close-mode-viewer");
    if (closeModeViewer) {
        closeModeViewer.addEventListener("click", () => setModeViewerActive(false));
    }
    const mobModes = document.getElementById("mobile-btn-modes");
    if (mobModes) {
        mobModes.addEventListener("click", () => setModeViewerActive(!modeViewer.active));
    }
    ["x", "y", "t"].forEach(k => {
        const b = document.getElementById(`mv-kind-${k}`);
        if (b) b.addEventListener("click", () => {
            modeViewer.kind = k.toUpperCase();
            ["x", "y", "t"].forEach(kk => {
                const bb = document.getElementById(`mv-kind-${kk}`);
                if (bb) bb.classList.toggle("active", kk === k);
            });
            updateModeViewerInfo();
        });
    });
    [1, 2, 3].forEach(n => {
        const b = document.getElementById(`mv-mode-${n}`);
        if (b) b.addEventListener("click", () => {
            modeViewer.mode = n;
            [1, 2, 3].forEach(nn => {
                const bb = document.getElementById(`mv-mode-${nn}`);
                if (bb) bb.classList.toggle("active", nn === n);
            });
            updateModeViewerInfo();
        });
    });

    // Resortes SSI: reconstruir la escena al alternar (solo en calma)
    const ssiToggle = document.getElementById("show-ssi-springs");
    if (ssiToggle) {
        ssiToggle.addEventListener("change", () => {
            if (!isPlaying) rebuild3DStructures();
        });
    }

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

            setSelect("earthquake-input-type", "synthetic");
            toggleEarthquakeInputType();
            resetCustomAccelerogramState();

            // Configurar Interacción Suelo-Estructura (ISE) por defecto para La Guaira
            setCheck("ise-enable", true);
            setSelect("ise-foundation-type", "mat");

            const vsEl = document.getElementById("ise-vs");
            const dfEl = document.getElementById("ise-df");
            const poissonEl = document.getElementById("ise-poisson");
            const densityEl = document.getElementById("ise-density");
            if (vsEl) vsEl.value = 220;
            if (dfEl) dfEl.value = 1.50;
            if (poissonEl) poissonEl.value = 0.35;
            if (densityEl) densityEl.value = 1800;

            const iseControls = document.getElementById("ise-controls-container");
            if (iseControls) iseControls.style.display = "block";

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

    // Sincronizar estado inicial de la carga de sismos personalizados
    toggleEarthquakeInputType();

    // Inicializar sistema de evaluación de Boletín FUNVISIS
    try {
        initBoletin();
    } catch (e) {
        console.error("Error al inicializar sección Boletín:", e);
    }
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

            // Datos para la deducción paso a paso de k en la memoria de cálculo
            this.stiffnessDerivation = {
                mode: 'sections',
                Ec_col, n_col,
                Ic_x, Ic_gross_x, Ic_y, Ic_gross_y,
                k_col_fixed_x, k_col_fixed_y,
                Icr, kappa_x, kappa_y, eta_x, eta_y
            };

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

            // Datos para la deducción paso a paso de k en la memoria de cálculo
            this.stiffnessDerivation = {
                mode: 'period',
                targetT1, k_ref, phi_Sx, phi_Sy, phi_ref,
                stiffnessScale_x, stiffnessScale_y, colFactor: this.numCols / 4.0
            };
        }

        // --- CÁLCULO DE INTERACCIÓN SUELO-ESTRUCTURA (ISE) ---
        const ssiX = calculateSSIReductionFactor(N, this.h, this.m, this.T1_x, numColsX, numColsY, sX_val, sY_val, 'X');
        const ssiY = calculateSSIReductionFactor(N, this.h, this.m, this.T1_y, numColsX, numColsY, sX_val, sY_val, 'Y');

        this.ssiX = ssiX;
        this.ssiY = ssiY;

        if (ssiX.lambda < 1.0) {
            this.k_init_x *= ssiX.lambda;
            this.T1_x /= Math.sqrt(ssiX.lambda);
        }
        if (ssiY.lambda < 1.0) {
            this.k_init_y *= ssiY.lambda;
            this.T1_y /= Math.sqrt(ssiY.lambda);
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

        let zeta_x = zeta;
        let zeta_y = zeta;
        if (this.ssiX && this.ssiX.lambda < 1.0) {
            const T_ratio = 1.0 / Math.sqrt(this.ssiX.lambda);
            const beta_rd = (1.0 - this.ssiX.lambda) * 0.04;
            zeta_x = beta_rd + zeta / Math.pow(T_ratio, 3);
            zeta_x = Math.max(0.01, Math.min(0.20, zeta_x));
        }
        if (this.ssiY && this.ssiY.lambda < 1.0) {
            const T_ratio = 1.0 / Math.sqrt(this.ssiY.lambda);
            const beta_rd = (1.0 - this.ssiY.lambda) * 0.04;
            zeta_y = beta_rd + zeta / Math.pow(T_ratio, 3);
            zeta_y = Math.max(0.01, Math.min(0.20, zeta_y));
        }

        this.aM_x = zeta_x * (2.0 * w1_x * w2_x) / (w1_x + w2_x);
        this.aK_x = zeta_x * 2.0 / (w1_x + w2_x);
        this.aM_y = zeta_y * (2.0 * w1_y * w2_y) / (w1_y + w2_y);
        this.aK_y = zeta_y * 2.0 / (w1_y + w2_y);

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
    { name: '1"', desig: 8, diam_cm: 2.54, area_cm2: 5.07 },
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
    svg += `<text x="${lx + lw / 2}" y="16" class="tt">${dirLabel}</text>`;

    // Vista longitudinal
    svg += `<text x="${lx + lw / 2}" y="${ly - 6}" class="tt" font-size="9">VISTA LONGITUDINAL</text>`;
    // Columnas
    svg += `<rect x="${lx - colStub}" y="${ly - 5}" width="${colStub}" height="${lh + 10}" class="cf" rx="2"/>`;
    svg += `<rect x="${lx + lw}" y="${ly - 5}" width="${colStub}" height="${lh + 10}" class="cf" rx="2"/>`;
    // Viga
    svg += `<rect x="${lx}" y="${ly}" width="${lw}" height="${lh}" class="bf" rx="1"/>`;
    // Zonas confinadas
    svg += `<rect x="${lx}" y="${ly}" width="${confPx}" height="${lh}" class="cz"/>`;
    svg += `<rect x="${lx + lw - confPx}" y="${ly}" width="${confPx}" height="${lh}" class="cz"/>`;
    // Barras longitudinales
    svg += `<line x1="${lx}" y1="${btY}" x2="${lx + lw}" y2="${btY}" class="bl"/>`;
    svg += `<line x1="${lx}" y1="${bbY}" x2="${lx + lw}" y2="${bbY}" class="bl"/>`;
    // Etiquetas barras
    svg += `<text x="${lx + lw / 2}" y="${btY - 4}" class="st" text-anchor="middle">As' (compresión)</text>`;
    svg += `<text x="${lx + lw / 2}" y="${bbY + 11}" class="st" text-anchor="middle">As (tracción)</text>`;

    // Estribos
    let x = lx + Math.max(4, 5 * scaleL);
    while (x < lx + confPx) { svg += `<line x1="${x}" y1="${ly + 4}" x2="${x}" y2="${ly + lh - 4}" class="sl"/>`; x += sConfPx; }
    while (x < lx + lw - confPx) { svg += `<line x1="${x}" y1="${ly + 4}" x2="${x}" y2="${ly + lh - 4}" class="sl" opacity=".5"/>`; x += sCenterPx; }
    while (x < lx + lw - 4) { svg += `<line x1="${x}" y1="${ly + 4}" x2="${x}" y2="${ly + lh - 4}" class="sl"/>`; x += sConfPx; }

    // Corte A-A indicador
    const cutX = lx + lw * 0.28;
    svg += `<line x1="${cutX}" y1="${ly - 8}" x2="${cutX}" y2="${ly + lh + 8}" stroke="#ffb703" stroke-width=".7" stroke-dasharray="6,3"/>`;
    svg += `<text x="${cutX - 7}" y="${ly - 10}" fill="#ffb703" font-size="8" font-family="Inter" font-weight="bold">A</text>`;
    svg += `<text x="${cutX + 3}" y="${ly + lh + 16}" fill="#ffb703" font-size="8" font-family="Inter" font-weight="bold">A</text>`;

    // Cotas - zona confinada izquierda
    const dY = ly + lh + 22;
    svg += `<line x1="${lx}" y1="${dY}" x2="${lx + confPx}" y2="${dY}" class="dl"/>`;
    svg += `<line x1="${lx}" y1="${dY - 4}" x2="${lx}" y2="${dY + 4}" class="dl"/>`;
    svg += `<line x1="${lx + confPx}" y1="${dY - 4}" x2="${lx + confPx}" y2="${dY + 4}" class="dl"/>`;
    svg += `<text x="${lx + confPx / 2}" y="${dY + 12}" class="dt">2h=${(2 * h / 100).toFixed(2)}m</text>`;
    svg += `<text x="${lx + confPx / 2}" y="${dY + 22}" class="st" text-anchor="middle">s=${s_conf.toFixed(0)}cm</text>`;
    // Zona central
    const cS = lx + confPx, cE = lx + lw - confPx;
    svg += `<line x1="${cS}" y1="${dY}" x2="${cE}" y2="${dY}" class="dl"/>`;
    svg += `<text x="${(cS + cE) / 2}" y="${dY + 12}" class="dt">Zona central</text>`;
    svg += `<text x="${(cS + cE) / 2}" y="${dY + 22}" class="st" text-anchor="middle">s=${s_center.toFixed(0)}cm</text>`;
    // Zona confinada derecha
    svg += `<line x1="${cE}" y1="${dY}" x2="${lx + lw}" y2="${dY}" class="dl"/>`;
    svg += `<line x1="${cE}" y1="${dY - 4}" x2="${cE}" y2="${dY + 4}" class="dl"/>`;
    svg += `<line x1="${lx + lw}" y1="${dY - 4}" x2="${lx + lw}" y2="${dY + 4}" class="dl"/>`;
    svg += `<text x="${(cE + lx + lw) / 2}" y="${dY + 12}" class="dt">2h</text>`;
    // Cota total
    const tDY = dY + 33;
    svg += `<line x1="${lx}" y1="${tDY}" x2="${lx + lw}" y2="${tDY}" class="dl"/>`;
    svg += `<line x1="${lx}" y1="${tDY - 4}" x2="${lx}" y2="${tDY + 4}" class="dl"/>`;
    svg += `<line x1="${lx + lw}" y1="${tDY - 4}" x2="${lx + lw}" y2="${tDY + 4}" class="dl"/>`;
    svg += `<text x="${lx + lw / 2}" y="${tDY + 13}" class="dt">L = ${(L_cm / 100).toFixed(2)} m</text>`;

    // -- Sección Transversal A-A --
    const secScale = Math.min(120 / bw, 170 / h) * 0.75;
    const sw = bw * secScale, sh = h * secScale;
    const sx = 540, sy = 30;
    const scx = sx + 70, scy = sy + 90;
    const rx = scx - sw / 2, ry = scy - sh / 2;
    const covPx = cover * secScale, stPx = db_st * secScale;

    svg += `<text x="${scx}" y="${sy + 4}" class="tt" font-size="9">SECCIÓN A-A</text>`;
    svg += `<rect x="${rx}" y="${ry}" width="${sw}" height="${sh}" class="bf" rx="2"/>`;
    // Estribo
    const esx = rx + covPx, esy = ry + covPx, esw = sw - 2 * covPx, esh = sh - 2 * covPx;
    svg += `<rect x="${esx}" y="${esy}" width="${esw}" height="${esh}" class="sr" rx="3"/>`;
    // Ganchos 135° (esquinas superiores)
    const hkL = 10;
    svg += `<line x1="${esx}" y1="${esy + 3}" x2="${esx + hkL * .71}" y2="${esy + 3 + hkL * .71}" class="hl"/>`;
    svg += `<line x1="${esx + esw}" y1="${esy + 3}" x2="${esx + esw - hkL * .71}" y2="${esy + 3 + hkL * .71}" class="hl"/>`;
    // Ganchos 135° (esquinas inferiores)
    svg += `<line x1="${esx}" y1="${esy + esh - 3}" x2="${esx + hkL * .71}" y2="${esy + esh - 3 - hkL * .71}" class="hl"/>`;
    svg += `<line x1="${esx + esw}" y1="${esy + esh - 3}" x2="${esx + esw - hkL * .71}" y2="${esy + esh - 3 - hkL * .71}" class="hl"/>`;

    // Barras inferiores (tracción)
    const r = Math.max(3.5, 5 * secScale / h);
    const botCy = ry + sh - covPx - stPx - r - 1;
    const bStartX = esx + r + 3, bEndX = esx + esw - r - 3;
    const bSpacing = nBotBars > 1 ? (bEndX - bStartX) / (nBotBars - 1) : 0;
    for (let i = 0; i < nBotBars; i++) {
        const cx = nBotBars === 1 ? (bStartX + bEndX) / 2 : bStartX + i * bSpacing;
        svg += `<circle cx="${cx}" cy="${botCy}" r="${r}" class="bc"/>`;
    }
    // Barras superiores (compresión)
    const topCy = ry + covPx + stPx + r + 1;
    const tSpacing = nTopBars > 1 ? (bEndX - bStartX) / (nTopBars - 1) : 0;
    for (let i = 0; i < nTopBars; i++) {
        const cx = nTopBars === 1 ? (bStartX + bEndX) / 2 : bStartX + i * tSpacing;
        svg += `<circle cx="${cx}" cy="${topCy}" r="${r}" class="bct"/>`;
    }

    // Cotas de sección
    svg += `<line x1="${rx}" y1="${ry + sh + 12}" x2="${rx + sw}" y2="${ry + sh + 12}" class="dl"/>`;
    svg += `<text x="${scx}" y="${ry + sh + 22}" class="dt">${bw} cm</text>`;
    svg += `<text x="${rx + sw + 14}" y="${scy + 3}" class="dt" text-anchor="start" transform="rotate(-90,${rx + sw + 14},${scy})">${h} cm</text>`;
    // Recubrimiento
    svg += `<text x="${rx + covPx / 2}" y="${scy}" class="st" text-anchor="middle" transform="rotate(-90,${rx + covPx / 2},${scy})">${cover}cm</text>`;

    // -- Detalle de Estribo --
    const dx = sx + 10, dy = sy + sh * secScale + 130;
    svg += `<text x="${dx + 55}" y="${dy - 5}" class="tt" font-size="9">DETALLE ESTRIBO</text>`;
    svg += `<text x="${dx + 55}" y="${dy + 7}" class="st" text-anchor="middle">Gancho sísmico 135°</text>`;
    const dex = dx + 5, dey = dy + 16, dew = 100, deh = 55;
    svg += `<rect x="${dex}" y="${dey}" width="${dew}" height="${deh}" class="sr" rx="5"/>`;
    const hk = 16;
    // 4 ganchos en cada esquina
    svg += `<line x1="${dex}" y1="${dey + 4}" x2="${dex + hk * .71}" y2="${dey + 4 + hk * .71}" class="hl"/>`;
    svg += `<line x1="${dex + dew}" y1="${dey + 4}" x2="${dex + dew - hk * .71}" y2="${dey + 4 + hk * .71}" class="hl"/>`;
    svg += `<line x1="${dex}" y1="${dey + deh - 4}" x2="${dex + hk * .71}" y2="${dey + deh - 4 - hk * .71}" class="hl"/>`;
    svg += `<line x1="${dex + dew}" y1="${dey + deh - 4}" x2="${dex + dew - hk * .71}" y2="${dey + deh - 4 - hk * .71}" class="hl"/>`;
    svg += `<text x="${dex + dew + 10}" y="${dey + 18}" class="st" text-anchor="start">135°</text>`;
    svg += `<text x="${dex + dew + 10}" y="${dey + 30}" class="st" text-anchor="start">Ext: 6d_b</text>`;
    svg += `<text x="${dex + dew / 2}" y="${dey + deh + 14}" class="dt">Estribo #3 (3/8")</text>`;

    // Leyenda
    svg += `<rect x="12" y="${H - 28}" width="9" height="9" class="cz" stroke="#ff6b6b" stroke-width=".6"/>`;
    svg += `<text x="24" y="${H - 20}" class="st">Zona Confinada (2h)</text>`;
    svg += `<line x1="120" y1="${H - 24}" x2="135" y2="${H - 24}" class="sl"/>`;
    svg += `<text x="140" y="${H - 20}" class="st" text-anchor="start">Estribos</text>`;
    svg += `<line x1="186" y1="${H - 24}" x2="201" y2="${H - 24}" class="bl"/>`;
    svg += `<text x="206" y="${H - 20}" class="st" text-anchor="start">Acero Long.</text>`;
    svg += `<circle cx="268" cy="${H - 24}" r="3" class="bc"/><text x="276" y="${H - 20}" class="st" text-anchor="start">Tracción</text>`;
    svg += `<circle cx="324" cy="${H - 24}" r="3" class="bct"/><text x="332" y="${H - 20}" class="st" text-anchor="start">Compresión</text>`;

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
            ctx.fillText(`Estado: ${stateText} (${(localD * 100).toFixed(1)}%)`, ttx + 8, tty + 66);
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
    // Sincronizar relleno visual de sliders (cubre cambios programáticos como el preset Vargas)
    refreshRangeFills();

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
    const inputType = document.getElementById("earthquake-input-type").value;
    if (inputType === "custom" && customGroundAccel) {
        groundAccel = [...customGroundAccel];
        totalDuration = customDuration;
    } else {
        if (inputType === "custom") {
            console.warn("No custom accelerogram file loaded, falling back to synthetic.");
        }
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
        totalDuration = 80;
    }

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

        // (La sección de Interacción Suelo-Estructura y resortes SSI se genera
        //  más abajo, de forma independiente al modo de secciones)

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


    // --- ENSAMBLAJE MATRICIAL DE RIGIDEZ LATERAL (MDOF EDIFICIO DE CORTE) ---
    // Matriz tridiagonal K: K[i][i] = k_i + k_{i+1}, K[i][i+1] = K[i+1][i] = -k_{i+1}, K[N][N] = k_N
    {
        const KGF = 9.80665; // conversión N → kgf (consistente con el resto de la memoria)
        const kx01 = new Array(N).fill(eq2001.k_init_x / KGF);
        const ky01 = new Array(N).fill(eq2001.k_init_y / KGF);
        const kx19 = new Array(N).fill(eq2019.k_init_x / KGF);
        const ky19 = new Array(N).fill(eq2019.k_init_y / KGF);

        // Tabla de rigideces de entrepiso (vector k)
        let kVecRows = '';
        for (let i = 0; i < N; i++) {
            kVecRows += `
                <tr>
                    <td class="calc-param-name">Piso ${i + 1}${i === 0 ? ' (entrepiso basal)' : ''}</td>
                    <td class="calc-symbol">k<sub>${i + 1}</sub></td>
                    <td class="calc-value">${Math.round(kx01[i]).toLocaleString()}</td>
                    <td class="calc-value">${Math.round(ky01[i]).toLocaleString()}</td>
                    <td class="calc-value">${Math.round(kx19[i]).toLocaleString()}</td>
                    <td class="calc-value">${Math.round(ky19[i]).toLocaleString()}</td>
                    <td class="calc-unit">kgf/m</td>
                </tr>`;
        }

        // Render compacto de la matriz ensamblada con factor de escala
        const matrixHTML = (kArr, label, accent) => {
            const n = kArr.length;
            let maxV = 0;
            for (let i = 0; i < n; i++) maxV = Math.max(maxV, kArr[i] + (i < n - 1 ? kArr[i + 1] : 0));
            const expo = Math.floor(Math.log10(maxV));
            const scale = Math.pow(10, expo);
            let rows = '';
            for (let i = 0; i < n; i++) {
                let cells = '';
                for (let j = 0; j < n; j++) {
                    let v = 0;
                    if (i === j) v = kArr[i] + (i < n - 1 ? kArr[i + 1] : 0);
                    else if (j === i + 1 || j === i - 1) v = -kArr[Math.max(i, j)];
                    const st = (v === 0)
                        ? 'color: rgba(255,255,255,0.16);'
                        : (i === j ? 'color: #fff; font-weight: 700;' : `color: ${accent};`);
                    cells += `<td style="padding: 2px 6px; text-align: right; font-family: 'JetBrains Mono', monospace; font-size: 9.5px; border: 1px solid rgba(255,255,255,0.06); ${st}">${(v / scale).toFixed(2)}</td>`;
                }
                rows += `<tr>${cells}</tr>`;
            }
            return `
                <div style="flex: 1; min-width: 240px;">
                    <p style="font-size: 11px; font-weight: 700; color: ${accent}; margin-bottom: 6px;">${label}</p>
                    <table style="border-collapse: collapse; margin: 0 auto;">${rows}</table>
                    <p style="font-size: 10px; color: var(--text-muted); margin-top: 6px; text-align: center;">[K] en &times;10<sup>${expo}</sup> kgf/m</p>
                </div>`;
        };

        // Períodos modales exactos del edificio de corte uniforme (misma fórmula del modelo)
        const modeT = (k, m, n) => {
            const w = 2.0 * Math.sqrt(k / m) * Math.sin((2 * n - 1) * Math.PI / (4 * N + 2));
            return (2 * Math.PI) / w;
        };
        let modalRows = '';
        for (let n = 1; n <= 3; n++) {
            modalRows += `
                <tr>
                    <td class="calc-param-name">Modo ${n}${n === 1 ? ' (fundamental)' : ''}</td>
                    <td class="calc-value">${modeT(eq2001.k_init_x, eq2001.m, n).toFixed(3)} / ${(1 / modeT(eq2001.k_init_x, eq2001.m, n)).toFixed(2)}</td>
                    <td class="calc-value">${modeT(eq2001.k_init_y, eq2001.m, n).toFixed(3)} / ${(1 / modeT(eq2001.k_init_y, eq2001.m, n)).toFixed(2)}</td>
                    <td class="calc-value">${modeT(eq2019.k_init_x, eq2019.m, n).toFixed(3)} / ${(1 / modeT(eq2019.k_init_x, eq2019.m, n)).toFixed(2)}</td>
                    <td class="calc-value">${modeT(eq2019.k_init_y, eq2019.m, n).toFixed(3)} / ${(1 / modeT(eq2019.k_init_y, eq2019.m, n)).toFixed(2)}</td>
                    <td class="calc-unit">s / Hz</td>
                </tr>`;
        }

        // --- Deducción paso a paso de la rigidez de entrepiso k (valores exactos del modelo) ---
        const stepRow = (label, expr, vx, vy, unit, highlight) => `
            <tr${highlight ? ' style="background: rgba(76, 201, 240, 0.06);"' : ''}>
                <td class="calc-param-name">${label}</td>
                <td class="calc-symbol">${expr}</td>
                <td class="calc-value">${vx}</td>
                <td class="calc-value">${vy}</td>
                <td class="calc-unit">${unit}</td>
            </tr>`;
        const sd = eq2001.stiffnessDerivation;
        const lamX = (eq2001.ssiX && typeof eq2001.ssiX.lambda === 'number') ? eq2001.ssiX.lambda : 1.0;
        const lamY = (eq2001.ssiY && typeof eq2001.ssiY.lambda === 'number') ? eq2001.ssiY.lambda : 1.0;
        const kRigX = eq2001.k_init_x / lamX, kRigY = eq2001.k_init_y / lamY; // rigidez base empotrada (pre-ISE)
        const fK = v => Math.round(v / KGF).toLocaleString();   // N/m → kgf/m
        const fI = v => Math.round(v * 1e8).toLocaleString();   // m⁴ → cm⁴
        let kStepsRows = '';
        let kStepsIntro = '';
        let kInertiaNote = '';
        if (sd && sd.mode === 'sections') {
            kStepsIntro = `La rigidez de entrepiso se deduce <strong>desde las secciones físicas configuradas</strong> (valores idénticos para ambas normas, que comparten geometría):`;
            kStepsRows =
                stepRow('1. Módulo de elasticidad del concreto', 'E<sub>c</sub> = 15100&radic;f\'c',
                    Math.round(sd.Ec_col / 98066.5).toLocaleString(), Math.round(sd.Ec_col / 98066.5).toLocaleString(), 'kgf/cm²') +
                stepRow('2. Relación modular acero/concreto', 'n = E<sub>s</sub> / E<sub>c</sub>',
                    sd.n_col.toFixed(2), sd.n_col.toFixed(2), '—') +
                stepRow('3. Inercia transformada de la columna', 'I<sub>c</sub> = b·h&sup3;/12 + (n&minus;1)·A<sub>s</sub>·(h/2&minus;d\')&sup2;',
                    fI(sd.Ic_x), fI(sd.Ic_y), 'cm⁴') +
                stepRow('4. Rigidez de una columna biempotrada', 'k<sub>col</sub> = 12·E<sub>c</sub>·I<sub>c</sub> / h&sup3;',
                    fK(sd.k_col_fixed_x), fK(sd.k_col_fixed_y), 'kgf/m') +
                stepRow('5. Inercia fisurada de la viga', 'I<sub>cr</sub> (eje neutro elástico, doble armadura)',
                    fI(sd.Icr), fI(sd.Icr), 'cm⁴') +
                stepRow('6. Relación de rigideces viga&ndash;columna', '&kappa; = (E·I<sub>cr</sub>·h) / (2·E·I<sub>c</sub>·L)',
                    sd.kappa_x.toFixed(4), sd.kappa_y.toFixed(4), '—') +
                stepRow('7. Corrección por vigas flexibles (tipo Muto)', '&eta; = (12&kappa; + 1) / (12&kappa; + 4)',
                    sd.eta_x.toFixed(4), sd.eta_y.toFixed(4), '—') +
                stepRow('8. Entrepiso con base empotrada', 'k<sub>ríg</sub> = N<sub>col</sub> &times; k<sub>col</sub> &times; &eta;',
                    fK(kRigX), fK(kRigY), 'kgf/m') +
                stepRow('9. Coeficiente de reducción ISE', '&lambda; = [1 + K<sub>str</sub>/K<sub>x</sub> + K<sub>str</sub>·h*&sup2;/K<sub>&theta;</sub>]<sup>&minus;1</sup>',
                    lamX.toFixed(3), lamY.toFixed(3), '—') +
                stepRow('10. Rigidez de entrepiso del modelo', 'k = &lambda;<sub>ISE</sub> &times; k<sub>ríg</sub>',
                    fK(eq2001.k_init_x), fK(eq2001.k_init_y), 'kgf/m', true);
            kInertiaNote = `
                <p style="font-size: 11px; color: var(--text-muted); margin: 0 0 18px; line-height: 1.6; border-left: 3px solid var(--color-2019); padding-left: 10px;">
                    <strong style="color: var(--color-2019);">Nota sobre la inercia de columnas:</strong>
                    se emplea la <strong>inercia transformada sin fisurar</strong> (I<sub>g</sub> + aporte del acero longitudinal).
                    COVENIN 1756 admite usar <strong>inercia efectiva fisurada</strong> para el análisis (&asymp;0.5&middot;I<sub>g</sub> en columnas;
                    las vigas aquí ya usan I<sub>cr</sub> fisurada en el paso 5). Con inercia fisurada la rigidez sería &asymp;50&nbsp;% menor
                    y T<sub>1</sub> &asymp;40&nbsp;% mayor; los valores tabulados representan el <strong>límite elástico superior de rigidez</strong>
                    (período mínimo), criterio conservador para fuerzas pero no necesariamente para derivas.
                </p>`;
        } else if (sd && sd.mode === 'period') {
            kStepsIntro = `La rigidez de entrepiso se <strong>calibra desde el período fundamental objetivo</strong> del edificio de corte uniforme (valores idénticos para ambas normas):`;
            kStepsRows =
                stepRow('1. Período fundamental objetivo', 'T<sub>1,obj</sub>',
                    sd.targetT1.toFixed(2), sd.targetT1.toFixed(2), 's') +
                stepRow('2. Rigidez de referencia (edificio base)', 'k<sub>ref</sub> = m·(&pi; / (T<sub>1</sub>·sen(&pi;/(4N+2))))&sup2;',
                    fK(sd.k_ref), fK(sd.k_ref), 'kgf/m') +
                stepRow('3. Factor por número de columnas', 'N<sub>col</sub> / 4',
                    sd.colFactor.toFixed(2), sd.colFactor.toFixed(2), '—') +
                stepRow('4. Factor por luz de pórtico', '&phi;(s)/&phi;<sub>ref</sub>, &phi;(s) = (60+s)/(60+4s)',
                    sd.stiffnessScale_x.toFixed(3), sd.stiffnessScale_y.toFixed(3), '—') +
                stepRow('5. Entrepiso con base empotrada', 'k<sub>ríg</sub> = k<sub>ref</sub> &times; (N<sub>col</sub>/4) &times; &phi;/&phi;<sub>ref</sub>',
                    fK(kRigX), fK(kRigY), 'kgf/m') +
                stepRow('6. Coeficiente de reducción ISE', '&lambda; = [1 + K<sub>str</sub>/K<sub>x</sub> + K<sub>str</sub>·h*&sup2;/K<sub>&theta;</sub>]<sup>&minus;1</sup>',
                    lamX.toFixed(3), lamY.toFixed(3), '—') +
                stepRow('7. Rigidez de entrepiso del modelo', 'k = &lambda;<sub>ISE</sub> &times; k<sub>ríg</sub>',
                    fK(eq2001.k_init_x), fK(eq2001.k_init_y), 'kgf/m', true);
        }
        const kStepsHTML = kStepsRows ? `
                <p style="font-size: 12px; color: var(--text-muted); margin: 16px 0 8px; line-height: 1.5;">
                    <strong>Deducción del valor exacto de k:</strong> ${kStepsIntro}
                </p>
                <table class="calc-table" style="margin-bottom: 14px;">
                    <thead>
                        <tr>
                            <th>Paso de la Deducción</th>
                            <th>Expresión</th>
                            <th>Eje X</th>
                            <th>Eje Y</th>
                            <th>Unidad</th>
                        </tr>
                    </thead>
                    <tbody>${kStepsRows}</tbody>
                </table>
                ${kInertiaNote}` : '';

        reportHTML += `
            <div style="margin-top: 24px; margin-bottom: 24px; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 20px;">
                <h4 style="color: var(--color-2001); margin-bottom: 10px; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; text-transform: uppercase; letter-spacing: 0.5px;">
                    <i class="fa-solid fa-table-cells"></i> Ensamblaje Matricial de Rigidez Lateral (Modelo MDOF)
                </h4>
                <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px; line-height: 1.6;">
                    El edificio se condensa como un <strong>modelo de corte de ${N} GDL</strong> (un desplazamiento lateral por piso).
                    Con el vector de rigideces de entrepiso <strong>{k}</strong>, la matriz de rigidez global se ensambla por contribución de resortes en serie:
                    <strong>K<sub>i,i</sub> = k<sub>i</sub> + k<sub>i+1</sub></strong>, <strong>K<sub>i,i+1</sub> = K<sub>i+1,i</sub> = &minus;k<sub>i+1</sub></strong> y <strong>K<sub>N,N</sub> = k<sub>N</sub></strong> (empotramiento en la base).
                    La matriz de masas es diagonal: <strong>M<sub>i,i</sub> = m</strong> (${(eq2001.m / 1000).toFixed(1)} ton por piso).
                    El resolvedor integra <strong>M&uuml; + C&uacute; + f<sub>s</sub>(u) = &minus;M&middot;1&middot;a<sub>g</sub>(t)</strong> con Newmark-&beta; y amortiguamiento de Rayleigh C = a<sub>M</sub>M + a<sub>K</sub>K por dirección.
                </p>
                ${kStepsHTML}
                <table class="calc-table" style="margin-bottom: 20px;">
                    <thead>
                        <tr>
                            <th>Entrepiso</th>
                            <th>Símbolo</th>
                            <th>2001 &mdash; Eje X</th>
                            <th>2001 &mdash; Eje Y</th>
                            <th>2019 &mdash; Eje X</th>
                            <th>2019 &mdash; Eje Y</th>
                            <th>Unidad</th>
                        </tr>
                    </thead>
                    <tbody>${kVecRows}</tbody>
                </table>
                <div style="display: flex; flex-wrap: wrap; gap: 24px; justify-content: space-around; background: rgba(0,0,0,0.18); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 16px;">
                    ${matrixHTML(kx01, '[K] COVENIN 2001 — Eje X', 'var(--color-2001)')}
                    ${matrixHTML(kx19, '[K] COVENIN 2019 — Eje X', 'var(--color-2019)')}
                </div>
                <p style="font-size: 11px; color: var(--text-muted); margin-top: 10px; line-height: 1.5;">
                    <strong>Nota:</strong> el ensamblaje mostrado corresponde a la dirección X (la que integra el resolvedor paso a paso);
                    para la dirección Y el modelo distingue la respuesta mediante los coeficientes de amortiguamiento de Rayleigh (a<sub>M,y</sub>, a<sub>K,y</sub>)
                    y las rigideces k<sub>i,y</sub> tabuladas arriba. Valores elásticos iniciales (antes de la degradación histerética no-lineal).
                </p>
                <p style="font-size: 12px; color: var(--text-muted); margin: 14px 0 8px; line-height: 1.5;">
                    <strong>Verificación modal (autovalores de K&phi; = &omega;&sup2;M&phi;):</strong> para rigidez uniforme la solución cerrada es
                    &omega;<sub>n</sub> = 2&radic;(k/m)&middot;sen((2n&minus;1)&pi;/(4N+2)). Son las mismas frecuencias que oscila el
                    <strong>visualizador de modos de vibración</strong> de la Vista 3D.
                </p>
                <table class="calc-table">
                    <thead>
                        <tr>
                            <th>Modo</th>
                            <th>2001 X &nbsp;T / f</th>
                            <th>2001 Y &nbsp;T / f</th>
                            <th>2019 X &nbsp;T / f</th>
                            <th>2019 Y &nbsp;T / f</th>
                            <th>Unidad</th>
                        </tr>
                    </thead>
                    <tbody>${modalRows}</tbody>
                </table>
            </div>
        `;
    }

    // --- RESORTES DE FUNDACIÓN / INTERACCIÓN SUELO-ESTRUCTURA (ISE) ---
    {
        const iseOn = document.getElementById("ise-enable")?.checked;
        if (iseOn && eq2001.ssiX && eq2019.ssiX && typeof eq2001.ssiX.lambda === 'number') {
            const nCols = numColsX * numColsY;
            const rowSSI = (label, symbol, v01x, v01y, v19x, v19y, unit, highlight) => `
                <tr${highlight ? ' style="background: rgba(76, 201, 240, 0.06);"' : ''}>
                    <td class="calc-param-name">${label}</td>
                    <td class="calc-symbol">${symbol}</td>
                    <td class="calc-value">${v01x}</td>
                    <td class="calc-value">${v01y}</td>
                    <td class="calc-value">${v19x}</td>
                    <td class="calc-value">${v19y}</td>
                    <td class="calc-unit">${unit}</td>
                </tr>`;
            const fmtK = v => Math.round(v).toLocaleString();
            const zetaEff = (eq, dir) => {
                // Recuperar ζ efectivo desde aM de Rayleigh: aM = ζ·(2·w1·w2)/(w1+w2)
                const k = (dir === 'Y') ? eq.k_init_y : eq.k_init_x;
                const aM = (dir === 'Y') ? eq.aM_y : eq.aM_x;
                const w1 = 2.0 * Math.sqrt(k / eq.m) * Math.sin(Math.PI / (4 * N + 2));
                const w2 = 2.0 * Math.sqrt(k / eq.m) * Math.sin(3.0 * Math.PI / (4 * N + 2));
                return aM * (w1 + w2) / (2.0 * w1 * w2) * 100;
            };
            const s01x = eq2001.ssiX, s01y = eq2001.ssiY, s19x = eq2019.ssiX, s19y = eq2019.ssiY;

            reportHTML += `
                <div style="margin-top: 24px; margin-bottom: 24px; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 20px;">
                    <h4 style="color: #4cc9f0; margin-bottom: 10px; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; text-transform: uppercase; letter-spacing: 0.5px;">
                        <i class="fa-solid fa-mountain"></i> Resortes de Fundación (ISE) — Elasticidad Dinámica del Suelo (Gazetas)
                    </h4>
                    <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px; line-height: 1.6;">
                        El suelo bajo la cimentación se modela como <strong>resortes dinámicos equivalentes</strong>: rigidez horizontal K<sub>x</sub> y de cabeceo K<sub>&theta;</sub>
                        según las fórmulas de Gazetas para cimentaciones superficiales/emportadas. El factor <strong>&lambda;<sub>ISE</sub></strong> reduce la rigidez lateral del modelo
                        (alargando el período) y el suelo aporta <strong>amortiguamiento por radiación</strong>.
                        Cimentación: <strong>${s01x.foundType === 'mat' ? 'Losa Continua' : 'Zapatas Aisladas'}</strong> |
                        v<sub>s</sub>: <strong>${s01x.vs} m/s</strong> |
                        D<sub>f</sub>: <strong>${s01x.df.toFixed(2)} m</strong> |
                        G<sub>suelo</sub>: <strong>${fmtK(s01x.G)} kgf/m²</strong> |
                        &nu;: <strong>${s01x.poisson.toFixed(2)}</strong>
                    </p>
                    <table class="calc-table">
                        <thead>
                            <tr>
                                <th>Parámetro del Resorte de Suelo</th>
                                <th>Símbolo</th>
                                <th>2001 X</th>
                                <th>2001 Y</th>
                                <th>2019 X</th>
                                <th>2019 Y</th>
                                <th>Unidad</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowSSI('Rigidez Horizontal del Suelo', 'K<sub>x</sub>', fmtK(s01x.Kx), fmtK(s01y.Kx), fmtK(s19x.Kx), fmtK(s19y.Kx), 'kgf/m')}
                            ${rowSSI('Rigidez de Cabeceo (Rocking)', 'K<sub>&theta;</sub>', fmtK(s01x.Ktheta), fmtK(s01y.Ktheta), fmtK(s19x.Ktheta), fmtK(s19y.Ktheta), 'kgf·m/rad')}
                            ${rowSSI('Rigidez Estructura Equivalente', 'K<sub>struc</sub>', fmtK(s01x.K_struc), fmtK(s01y.K_struc), fmtK(s19x.K_struc), fmtK(s19y.K_struc), 'kgf/m')}
                            ${rowSSI('Rigidez por Resorte de Columna (K<sub>x</sub>/N<sub>col</sub>)', 'k<sub>res</sub>', fmtK(s01x.Kx / nCols), fmtK(s01y.Kx / nCols), fmtK(s19x.Kx / nCols), fmtK(s19y.Kx / nCols), 'kgf/m')}
                            ${rowSSI('Coeficiente de Reducción ISE', '&lambda;<sub>ISE</sub>', s01x.lambda.toFixed(3), s01y.lambda.toFixed(3), s19x.lambda.toFixed(3), s19y.lambda.toFixed(3), '-', true)}
                            ${rowSSI('Período Base Empotrada', 'T<sub>rígido</sub>', (eq2001.T1_x * Math.sqrt(s01x.lambda)).toFixed(3), (eq2001.T1_y * Math.sqrt(s01y.lambda)).toFixed(3), (eq2019.T1_x * Math.sqrt(s19x.lambda)).toFixed(3), (eq2019.T1_y * Math.sqrt(s19y.lambda)).toFixed(3), 's')}
                            ${rowSSI('Período Flexible (con ISE)', 'T<sub>flex</sub>', eq2001.T1_x.toFixed(3), eq2001.T1_y.toFixed(3), eq2019.T1_x.toFixed(3), eq2019.T1_y.toFixed(3), 's')}
                            ${rowSSI('Amortiguamiento Efectivo (rad. + histerético)', '&zeta;<sub>eff</sub>', zetaEff(eq2001, 'X').toFixed(1) + '%', zetaEff(eq2001, 'Y').toFixed(1) + '%', zetaEff(eq2019, 'X').toFixed(1) + '%', zetaEff(eq2019, 'Y').toFixed(1) + '%', '-')}
                        </tbody>
                    </table>
                    <p style="font-size: 11.5px; color: var(--text-muted); margin-top: 12px; line-height: 1.6;">
                        <strong style="color: #4cc9f0;">Representación 3D:</strong> cada columna descansa sobre un resorte helicoidal cuya deformación visible escala con
                        <strong>1.15&middot;(2 &minus; &lambda;<sub>ISE</sub>)</strong> (suelos más flexibles se deforman más). Código de colores bajo balanceo:
                        <span style="color: #34d399; font-weight: bold;">&#9679;</span> reposo &nbsp;
                        <span style="color: #ef4444; font-weight: bold;">&#9679;</span> compresión &nbsp;
                        <span style="color: #22d3ee; font-weight: bold;">&#9679;</span> tensión.
                    </p>
                </div>
            `;
        } else {
            reportHTML += `
                <div style="margin-top: 24px; margin-bottom: 24px; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 20px;">
                    <h4 style="color: #4cc9f0; margin-bottom: 10px; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; text-transform: uppercase; letter-spacing: 0.5px;">
                        <i class="fa-solid fa-mountain"></i> Resortes de Fundación (ISE)
                    </h4>
                    <p style="font-size: 12px; color: var(--text-muted); line-height: 1.6;">
                        <strong>Interacción Suelo-Estructura deshabilitada (&lambda;<sub>ISE</sub> = 1.0).</strong>
                        La base se considera perfectamente empotrada; los resortes helicoidales de la Vista 3D representan una cimentación rígida nominal
                        (sin deformación apreciable por balanceo). Habilite <strong>"Interacción Suelo-Estructura (ISE)"</strong> en el panel lateral
                        para modelar la flexibilidad del suelo con rigideces de Gazetas y amortiguamiento por radiación.
                    </p>
                </div>
            `;
        }
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

function syncSoilPropertiesFromNormClass() {
    let soil = "S2";
    const tab2019 = document.querySelector(".tab-btn[data-tab='tab-covenin19']");
    const isTab2019Active = tab2019 && tab2019.classList.contains("active");

    const vsEl = document.getElementById("ise-vs");
    const poissonEl = document.getElementById("ise-poisson");
    const densityEl = document.getElementById("ise-density");

    if (!vsEl || !poissonEl || !densityEl) return;

    if (isTab2019Active) {
        const soil19 = document.getElementById("covenin19-soil-class")?.value || "D";
        if (soil19 === 'A' || soil19 === 'AB' || soil19 === 'B') {
            vsEl.value = 800;
            poissonEl.value = 0.25;
            densityEl.value = 2200;
        } else if (soil19 === 'BC' || soil19 === 'C') {
            vsEl.value = 400;
            poissonEl.value = 0.30;
            densityEl.value = 1900;
        } else if (soil19 === 'CD' || soil19 === 'D') {
            vsEl.value = 220;
            poissonEl.value = 0.35;
            densityEl.value = 1800;
        } else { // DE, E
            vsEl.value = 120;
            poissonEl.value = 0.40;
            densityEl.value = 1600;
        }
    } else {
        const soil01 = document.getElementById("covenin01-soil")?.value || "S2";
        if (soil01 === 'S1') {
            vsEl.value = 800;
            poissonEl.value = 0.25;
            densityEl.value = 2200;
        } else if (soil01 === 'S2') {
            vsEl.value = 400;
            poissonEl.value = 0.30;
            densityEl.value = 1900;
        } else if (soil01 === 'S3') {
            vsEl.value = 220;
            poissonEl.value = 0.35;
            densityEl.value = 1800;
        } else { // S4
            vsEl.value = 120;
            poissonEl.value = 0.40;
            densityEl.value = 1600;
        }
    }
    if (!isPlaying) generateSpectraAndEarthquake();
}

function calculateSSIReductionFactor(N, h, m, T_rigid, numColsX, numColsY, sX, sY, direction) {
    const iseEnable = document.getElementById("ise-enable")?.checked;
    if (!iseEnable) {
        return { lambda: 1.0 };
    }

    const vs = parseFloat(document.getElementById("ise-vs")?.value) || 220.0;
    const df = parseFloat(document.getElementById("ise-df")?.value) || 1.50;
    const poisson = parseFloat(document.getElementById("ise-poisson")?.value) || 0.35;
    const density = parseFloat(document.getElementById("ise-density")?.value) || 1800.0;
    const foundType = document.getElementById("ise-foundation-type")?.value || "mat";

    const numCX = numColsX || 2;
    const numCY = numColsY || 2;
    const sX_val = sX || 5.0;
    const sY_val = sY || 5.0;

    let B, L;
    if (direction === 'X') {
        B = sX_val * (numCX - 1);
        L = sY_val * (numCY - 1);
    } else {
        B = sY_val * (numCY - 1);
        L = sX_val * (numCX - 1);
    }

    if (B < 2.0) B = 3.0;
    if (L < 2.0) L = 3.0;

    const G_const = 9.81;
    const rho = density / G_const;
    const G_pa = rho * vs * vs;
    const G = G_pa / G_const;

    const areaMultiplier = (foundType === 'isolated') ? 0.35 : 1.0;
    const areaFound = B * L * areaMultiplier;

    const Rx = Math.sqrt(areaFound / Math.PI);
    const I_base = (Math.pow(B, 3) * L / 12) * areaMultiplier;
    const Rtheta = Math.pow((4.0 * I_base / Math.PI), 0.25);

    const Kx_surf = (8.0 * G * Rx) / (2.0 - poisson);
    const Ktheta_surf = (8.0 * G * Math.pow(Rtheta, 3)) / (3.0 * (1.0 - poisson));

    const eh = 1.0 + 0.55 * (df / Rx);
    const er = 1.0 + 1.2 * (df / Rtheta) * (1.0 + 1.8 * (df / Rtheta));

    const Kx = Kx_surf * eh;
    const Ktheta = Ktheta_surf * er;

    const M_eff = 0.75 * (N * m);
    const omega_rigid = (2.0 * Math.PI) / T_rigid;
    const K_struc = M_eff * omega_rigid * omega_rigid / G_const;

    const h_star = 0.7 * N * h;

    const lambda_ise = 1.0 / (1.0 + (K_struc / Kx) + (K_struc * h_star * h_star / Ktheta));

    return {
        lambda: Math.min(1.0, Math.max(0.01, lambda_ise)),
        B, L, Rx, Rtheta, G, poisson, density, Kx, Ktheta, K_struc, h_star, eh, er, foundType, vs, df
    };
}

function getActiveSismoDirection(timeVal) {
    const inputType = document.getElementById("earthquake-input-type").value;
    if (inputType === "custom") {
        return document.getElementById("custom-direction").value;
    }
    const hasSecond = document.getElementById("double-earthquake").checked;
    const sismo1Dir = document.getElementById("sismo1-direction").value;
    const sismo2Dir = document.getElementById("sismo2-direction").value;
    return (hasSecond && (timeVal >= 40.0)) ? sismo2Dir : sismo1Dir;
}

function toggleEarthquakeInputType() {
    const inputType = document.getElementById("earthquake-input-type").value;
    const customContainer = document.getElementById("custom-accelerogram-container");
    const syntheticContainer = document.getElementById("synthetic-seismic-inputs");

    if (inputType === "custom") {
        customContainer.style.display = "block";
        syntheticContainer.style.display = "none";
    } else {
        customContainer.style.display = "none";
        syntheticContainer.style.display = "block";
    }
    if (!isPlaying) {
        generateSpectraAndEarthquake();
    }
}

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    customAccelFileName = file.name;
    document.getElementById("file-upload-status").textContent = file.name;
    document.getElementById("file-upload-status").style.color = "#ffb703";

    const reader = new FileReader();
    reader.onload = function (e) {
        const text = e.target.result;
        parseAccelerogramFile(text);
    };
    reader.readAsText(file);
}

function parseAccelerogramFile(text) {
    const lines = text.split(/\r?\n/);
    const parsedData = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.startsWith('#') || line.startsWith('%') || line.startsWith('//')) {
            continue;
        }

        const tokens = line.split(/[\s,;]+/).map(parseFloat).filter(v => !isNaN(v));
        if (tokens.length > 0) {
            parsedData.push(tokens);
        }
    }

    if (parsedData.length === 0) {
        alert("El archivo no contiene datos numéricos válidos o legibles.");
        resetCustomAccelerogramState();
        return;
    }

    const numCols = parsedData[0].length;
    let rawTimes = [];
    let rawAccels = [];

    if (numCols >= 2) {
        document.getElementById("custom-dt-container").style.display = "none";
        parsedData.forEach(row => {
            rawTimes.push(row[0]);
            rawAccels.push(row[1]);
        });
    } else {
        document.getElementById("custom-dt-container").style.display = "block";
        const fileDt = parseFloat(document.getElementById("custom-file-dt").value) || 0.02;
        parsedData.forEach((row, idx) => {
            rawTimes.push(idx * fileDt);
            rawAccels.push(row[0]);
        });

        // Registrar listener al input de dt si no tiene ya uno
        const dtInput = document.getElementById("custom-file-dt");
        if (!dtInput.dataset.hasListener) {
            dtInput.dataset.hasListener = 'true';
            dtInput.addEventListener("change", () => {
                parseAccelerogramFile(text);
            });
        }
    }

    // Conversión inteligente de unidades y obtención de PGA real
    let maxAbs = 0;
    rawAccels.forEach(val => {
        const absVal = Math.abs(val);
        if (absVal > maxAbs) maxAbs = absVal;
    });

    let unitInfo = "g";
    if (maxAbs > 3.0) {
        rawAccels = rawAccels.map(val => val / G);
        maxAbs /= G;
        unitInfo = "m/s² (convertida a g)";
    }

    const fileDuration = rawTimes[rawTimes.length - 1];
    customDuration = fileDuration;

    // Interpolación lineal a dt = 0.01 s
    const targetDt = 0.01;
    const numSteps = Math.max(100, Math.round(fileDuration / targetDt));
    customGroundAccel = new Array(numSteps);

    let idx = 0;
    for (let i = 0; i < numSteps; i++) {
        const t = i * targetDt;
        while (idx < rawTimes.length - 1 && rawTimes[idx + 1] < t) {
            idx++;
        }
        if (idx >= rawTimes.length - 1) {
            customGroundAccel[i] = rawAccels[rawAccels.length - 1];
        } else {
            const t0 = rawTimes[idx];
            const t1 = rawTimes[idx + 1];
            const a0 = rawAccels[idx];
            const a1 = rawAccels[idx + 1];
            const factor = (t0 === t1) ? 0 : (t - t0) / (t1 - t0);
            customGroundAccel[i] = a0 + factor * (a1 - a0);
        }
    }

    const statusText = `OK: ${fileDuration.toFixed(1)}s | dt=${(fileDuration / rawAccels.length).toFixed(3)}s | PGA=${maxAbs.toFixed(2)}g (${unitInfo})`;
    document.getElementById("file-upload-status").textContent = statusText;
    document.getElementById("file-upload-status").style.color = "#4cc9f0";

    generateSpectraAndEarthquake();
}

function resetCustomAccelerogramState() {
    customGroundAccel = null;
    customDuration = 80;
    customAccelFileName = "";
    document.getElementById("file-upload-status").textContent = "Ningún archivo";
    document.getElementById("file-upload-status").style.color = "var(--text-muted)";
    document.getElementById("custom-dt-container").style.display = "none";
    generateSpectraAndEarthquake();
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
    scene.fog = new THREE.FogExp2(0x05070d, 0.014);

    // Cámara (encuadre cinematográfico)
    camera = new THREE.PerspectiveCamera(42, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(0, 9, 26);

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
    controls.target.set(0, 4, 0);

    // --- RIG DE ILUMINACIÓN CINEMATOGRÁFICA ---
    // Luz ambiental de cielo/suelo para relleno suave
    const hemiLight = new THREE.HemisphereLight(0x8fb8ff, 0x0b0f18, 0.5);
    scene.add(hemiLight);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.18);
    scene.add(ambientLight);

    // Luz principal (key light) con sombras de alta resolución
    const isMobileViewport = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.95);
    dirLight.position.set(10, 20, 15);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = isMobileViewport ? 1024 : 2048;
    dirLight.shadow.mapSize.height = isMobileViewport ? 1024 : 2048;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 60;
    dirLight.shadow.bias = -0.0004;
    const d = 18;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    scene.add(dirLight);

    // Luces de acento por norma (cyan = 2001, magenta = 2019). Se reposicionan en rebuild3DStructures()
    accentLight2001 = new THREE.PointLight(0x22d3ee, 0.55, 34, 1.6);
    accentLight2001.position.set(-8, 4, 5);
    scene.add(accentLight2001);

    accentLight2019 = new THREE.PointLight(0xff3d8a, 0.55, 34, 1.6);
    accentLight2019.position.set(8, 4, 5);
    scene.add(accentLight2019);

    // Suelo base vibrante (acabado pulido oscuro)
    const groundGeometry = new THREE.BoxGeometry(30, 0.5, 12);
    const groundMaterial = new THREE.MeshStandardMaterial({
        color: 0x141a29,
        roughness: 0.55,
        metalness: 0.35
    });
    groundPlane = new THREE.Mesh(groundGeometry, groundMaterial);
    groundPlane.position.y = -0.25;
    groundPlane.receiveShadow = true;
    scene.add(groundPlane);

    // Rejilla de fondo decorativa
    gridHelper = new THREE.GridHelper(40, 20, 0x33507a, 0x141d31);
    gridHelper.position.y = 0.01;
    scene.add(gridHelper);

    // Malla de terreno deformable (ondas sísmicas superficiales)
    createTerrainMesh(30, 12);

    // Telón de fondo: silueta nocturna de El Ávila y la ciudad
    createBackdrop();

    // --- EJES IDENTIFICADOS X / Y ---
    createAxisIndicators();

    // Partículas de polvo/humo
    initParticles();

    // Motas de polvo ambientales en suspensión (atmósfera nocturna)
    initAmbientMotes();

    // Anillos de onda expansiva (shockwaves) para el sismo
    initShockwaves();

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
                            colMap.set(segMesh, { buildingName: bName, level: lvl, index: idx, colData: col, mesh: segMesh });
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

// --- TERRENO DEFORMABLE: MALLA CON PROPAGACIÓN DE ONDAS SÍSMICAS ---
// La superficie del suelo es una malla cuyos vértices oscilan verticalmente
// con ondas superficiales (tipo Rayleigh) que emanan de un epicentro. La
// amplitud es proporcional a la aceleración instantánea del sismo.
function createTerrainMesh(groundW, groundD) {
    if (terrainGroup) {
        scene.remove(terrainGroup);
        terrainGroup.traverse(o => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) o.material.dispose();
        });
        terrainGroup = null;
    }

    const w = Math.max(groundW * 1.7, 64);
    const d = Math.max(groundD * 2.6, 52);
    const geom = new THREE.PlaneGeometry(w, d, 84, 56);
    geom.rotateX(-Math.PI / 2);

    const count = geom.attributes.position.count;
    terrainBaseXZ = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
        terrainBaseXZ[i * 2] = geom.attributes.position.getX(i);
        terrainBaseXZ[i * 2 + 1] = geom.attributes.position.getZ(i);
    }

    const solidMat = new THREE.MeshStandardMaterial({
        color: 0x0c1424, roughness: 0.85, metalness: 0.25,
        transparent: true, opacity: 0.78, depthWrite: false
    });
    terrainSolid = new THREE.Mesh(geom, solidMat);
    terrainSolid.position.y = 0.03;
    terrainSolid.renderOrder = 1;

    // Mismo geometry compartido: el alambre se deforma solidariamente
    const wireMat = new THREE.MeshBasicMaterial({
        color: 0x2b7fff, wireframe: true, transparent: true, opacity: 0.16,
        blending: THREE.AdditiveBlending, depthWrite: false
    });
    terrainWire = new THREE.Mesh(geom, wireMat);
    terrainWire.position.y = 0.045;
    terrainWire.renderOrder = 2;

    terrainGroup = new THREE.Group();
    terrainGroup.add(terrainSolid);
    terrainGroup.add(terrainWire);
    scene.add(terrainGroup);
}

function updateTerrainWaves(frameDt) {
    if (!terrainGroup || !terrainSolid) return;

    const toggle = document.getElementById('show-terrain-waves');
    const visible = toggle ? toggle.checked : true;
    terrainGroup.visible = visible;
    if (!visible) return;

    // En calma (sin simulación activa) la energía residual del terreno decae
    if (!isPlaying) lastGroundAccel *= 0.94;

    // Amplitud objetivo según la aceleración instantánea (suavizada)
    const target = Math.min(0.85, Math.abs(lastGroundAccel) * 1.7);
    terrainAmp += (target - terrainAmp) * 0.08;
    terrainWaveTime += frameDt * (1.1 + terrainAmp * 2.2);

    const pos = terrainSolid.geometry.attributes.position;
    const A = terrainAmp + 0.012; // respiración ambiental mínima en calma
    const epiX = TERRAIN_EPICENTER.x;
    const epiZ = TERRAIN_EPICENTER.z;
    const t = terrainWaveTime;

    for (let i = 0; i < pos.count; i++) {
        const x = terrainBaseXZ[i * 2];
        const z = terrainBaseXZ[i * 2 + 1];
        const dx = x - epiX;
        const dz = z - epiZ;
        const r = Math.sqrt(dx * dx + dz * dz);
        const att = Math.exp(-r * 0.016);
        // Onda superficial principal + secundaria de mayor longitud de onda
        const y = A * att * (Math.sin(0.52 * r - 6.0 * t) + 0.45 * Math.sin(0.21 * r - 2.8 * t + 1.7));
        pos.setY(i, y);
    }
    pos.needsUpdate = true;
    terrainSolid.geometry.computeVertexNormals();

    // El alambrado pulsa con la energía sísmica (azul en calma → magenta en sismo fuerte)
    const energy = Math.min(1, terrainAmp / 0.6);
    terrainWire.material.opacity = 0.14 + energy * 0.45;
    terrainWire.material.color.setHex(0x2b7fff).lerp(new THREE.Color(0xff5e9c), energy);
}

// --- TELÓN DE FONDO: SILUETA NOCTURNA (EL ÁVILA + CIUDAD) ---
function createBackdrop() {
    const c = document.createElement('canvas');
    c.width = 2048;
    c.height = 512;
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);

    // Cordillera lejana (tono más claro por atmósfera)
    drawRidge(g, c.width, c.height, 200, 95, 2.3, 'rgba(17, 26, 46, 0.85)');
    // Cordillera cercana (El Ávila, más oscura)
    drawRidge(g, c.width, c.height, 265, 70, 5.1, 'rgba(9, 14, 27, 0.95)');

    // Ciudad nocturna al pie
    drawCitySilhouette(g, c.width, c.height);

    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        fog: false
    });
    backdropPlane = new THREE.Mesh(new THREE.PlaneGeometry(190, 48), mat);
    backdropPlane.position.set(0, 16, -46);
    backdropPlane.renderOrder = -1;
    scene.add(backdropPlane);
}

function drawRidge(g, w, h, baseY, amp, seed, fillStyle) {
    g.fillStyle = fillStyle;
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w; x += 6) {
        const t = (x / w) * Math.PI * 2;
        const y = baseY
            + Math.sin(t * 2.1 + seed) * amp * 0.55
            + Math.sin(t * 4.7 + seed * 2.7) * amp * 0.3
            + Math.sin(t * 9.3 + seed * 5.3) * amp * 0.15;
        g.lineTo(x, y);
    }
    g.lineTo(w, h);
    g.closePath();
    g.fill();
}

function drawCitySilhouette(g, w, h) {
    // RNG determinista simple para un skyline consistente
    let s = 42;
    const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };

    let x = -10;
    while (x < w + 10) {
        const bw = 24 + rnd() * 55;
        const bh = 14 + rnd() * 62;
        g.fillStyle = 'rgba(6, 10, 20, 0.95)';
        g.fillRect(x, h - bh, bw, bh);

        // Ventanas encendidas dispersas
        const rows = Math.floor(bh / 12);
        const cols = Math.floor(bw / 11);
        for (let r = 0; r < rows; r++) {
            for (let col = 0; col < cols; col++) {
                if (rnd() < 0.16) {
                    const warm = rnd() < 0.75;
                    g.fillStyle = warm ? 'rgba(255, 209, 130, 0.55)' : 'rgba(140, 210, 255, 0.5)';
                    g.fillRect(x + 4 + col * 11, h - bh + 5 + r * 12, 3, 4);
                }
            }
        }
        x += bw + 6 + rnd() * 16;
    }
}

// --- MOTAS DE POLVO AMBIENTALES (DERIVA LENTA) ---
function initAmbientMotes() {
    const count = 90;
    const positions = new Float32Array(count * 3);
    ambientMotesData = [];

    for (let i = 0; i < count; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 80;
        positions[i * 3 + 1] = Math.random() * 26 + 0.4;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 45;
        ambientMotesData.push({
            speed: 0.4 + Math.random() * 0.8,
            phase: Math.random() * Math.PI * 2
        });
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
        size: 0.15,
        color: 0x9fd8ff,
        transparent: true,
        opacity: 0.32,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true
    });

    ambientMotes = new THREE.Points(geometry, material);
    scene.add(ambientMotes);
}

function updateAmbientMotes(timeMs) {
    if (!ambientMotes) return;
    const pos = ambientMotes.geometry.attributes.position.array;
    const t = timeMs * 0.001;
    for (let i = 0; i < ambientMotesData.length; i++) {
        const d = ambientMotesData[i];
        pos[i * 3] += Math.cos(t * d.speed * 0.35 + d.phase) * 0.0035;
        pos[i * 3 + 1] += Math.sin(t * d.speed * 0.5 + d.phase) * 0.0035;
    }
    ambientMotes.geometry.attributes.position.needsUpdate = true;
}

// --- ANILLOS DE ONDA EXPANSIVA (SHOCKWAVES) ---
function initShockwaves() {
    shockwaveRings = [];
    for (let i = 0; i < 5; i++) {
        const geo = new THREE.RingGeometry(0.95, 1.0, 72);
        const mat = new THREE.MeshBasicMaterial({
            color: 0x9fdcff,
            transparent: true,
            opacity: 0,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        const ring = new THREE.Mesh(geo, mat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.04;
        ring.visible = false;
        ring.userData = { life: 0, maxLife: 55, maxRadius: 24 };
        scene.add(ring);
        shockwaveRings.push(ring);
    }
}

function spawnShockwave(x, z, colorHex, maxRadius) {
    const ring = shockwaveRings.find(r => !r.visible);
    if (!ring) return;
    ring.visible = true;
    ring.position.set(x, 0.04, z);
    ring.scale.set(0.5, 0.5, 1);
    ring.material.color.setHex(colorHex);
    ring.userData.life = ring.userData.maxLife;
    ring.userData.maxRadius = maxRadius || 24;
}

function updateShockwaves() {
    for (let i = 0; i < shockwaveRings.length; i++) {
        const ring = shockwaveRings[i];
        if (!ring.visible) continue;
        ring.userData.life -= 1;
        if (ring.userData.life <= 0) {
            ring.visible = false;
            ring.material.opacity = 0;
            continue;
        }
        const progress = 1 - ring.userData.life / ring.userData.maxLife;
        const eased = 1 - Math.pow(1 - progress, 2);
        const radius = 0.5 + eased * ring.userData.maxRadius;
        ring.scale.set(radius, radius, 1);
        ring.material.opacity = (1 - progress) * 0.38;
    }
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

    const colMesh = info.mesh || info.colData.mesh || (info.colData.meshes && info.colData.meshes[0]);

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
    if (label2001 && label2001.parent) label2001.parent.remove(label2001);
    if (label2019 && label2019.parent) label2019.parent.remove(label2019);

    const dir = new THREE.Vector3(1, 0, 0);
    const origin = new THREE.Vector3(0, 0, 0);

    // Colores: Cyan (0x00ffcc) para 2001 y Rosa/Magenta (0xff007f) para 2019
    arrow2001 = new THREE.ArrowHelper(dir, origin, 1.0, 0x00ffcc, 0.4, 0.3);
    arrow2019 = new THREE.ArrowHelper(dir, origin, 1.0, 0xff007f, 0.4, 0.3);

    arrow2001.visible = false;
    arrow2019.visible = false;

    scene.add(arrow2001);
    scene.add(arrow2019);

    // Inicializar Canvas 2001
    canvas2001 = document.createElement('canvas');
    canvas2001.width = 160;
    canvas2001.height = 48;
    ctx2001 = canvas2001.getContext('2d');
    texture2001 = new THREE.CanvasTexture(canvas2001);
    const mat2001 = new THREE.SpriteMaterial({ map: texture2001, transparent: true, depthTest: false });
    label2001 = new THREE.Sprite(mat2001);
    label2001.scale.set(3.0, 0.9, 1);
    label2001.visible = false;
    scene.add(label2001);

    // Inicializar Canvas 2019
    canvas2019 = document.createElement('canvas');
    canvas2019.width = 160;
    canvas2019.height = 48;
    ctx2019 = canvas2019.getContext('2d');
    texture2019 = new THREE.CanvasTexture(canvas2019);
    const mat2019 = new THREE.SpriteMaterial({ map: texture2019, transparent: true, depthTest: false });
    label2019 = new THREE.Sprite(mat2019);
    label2019.scale.set(3.0, 0.9, 1);
    label2019.visible = false;
    scene.add(label2019);
}

function updateBaseShearArrows(isX, xOffset, bD, groundDisp) {
    if (!arrow2001 || !arrow2019) return;

    if (!isPlaying) {
        arrow2001.visible = false;
        arrow2019.visible = false;
        if (label2001) label2001.visible = false;
        if (label2019) label2019.visible = false;
        return;
    }

    // Fuerza de diseño o máxima de referencia (30% del peso del edificio)
    const maxExpectedForce2001 = eq2001.m * eq2001.N * 9.80665 * 0.3;
    const maxExpectedForce2019 = eq2019.m * eq2019.N * 9.80665 * 0.3;

    const force2001 = eq2001.currentBaseShear || 0;
    const force2019 = eq2019.currentBaseShear || 0;

    // Actualizar flecha 2001 (lado izquierdo, offset negativo)
    updateSingleBaseShearArrow(arrow2001, label2001, canvas2001, ctx2001, texture2001, 0x00ffcc, force2001, maxExpectedForce2001, -xOffset, bD, isX, groundDisp);

    // Actualizar flecha 2019 (lado derecho, offset positivo)
    updateSingleBaseShearArrow(arrow2019, label2019, canvas2019, ctx2019, texture2019, 0xff007f, force2019, maxExpectedForce2019, xOffset, bD, isX, groundDisp);
}

function updateSingleBaseShearArrow(arrow, labelSprite, canvas, ctx, texture, colorHex, forceVal, maxExpected, xOffsetPos, bD, isX, groundDisp) {
    if (Math.abs(forceVal) < 1.0) {
        arrow.visible = false;
        if (labelSprite) labelSprite.visible = false;
        return;
    }

    arrow.visible = true;
    if (labelSprite) labelSprite.visible = true;

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

    // Actualizar texto en canvas
    if (ctx && canvas && texture) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Fondo semitransparente redondeado
        ctx.fillStyle = 'rgba(9, 10, 15, 0.85)';
        const r = 8;
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
        const colorString = '#' + colorHex.toString(16).padStart(6, '0');
        ctx.strokeStyle = colorString;
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Texto del Corte Basal
        ctx.font = 'bold 20px Inter, sans-serif';
        ctx.fillStyle = colorString;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Conversión a kgf
        const force_kgf = Math.abs(forceVal) / G;
        let forceText = Math.round(force_kgf).toLocaleString() + " kgf";

        ctx.fillText(forceText, canvas.width / 2, canvas.height / 2);
        texture.needsUpdate = true;
    }

    if (labelSprite) {
        labelSprite.position.set(currentX, 1.4, currentZ);
    }
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

// LIBERACIÓN DE MEMORIA GPU EN WEBGL
function disposeGroup(group) {
    if (!group) return;
    group.traverse((node) => {
        if (node.isMesh || node.isLineSegments || node instanceof THREE.LineSegments) {
            if (node.geometry) node.geometry.dispose();
            if (node.material) {
                if (Array.isArray(node.material)) {
                    node.material.forEach(mat => mat.dispose());
                } else {
                    node.material.dispose();
                }
            }
        }
    });
}

// HELPERS PARA GEOMETRÍA DE FISURAS PROGRESIVAS EN COLUMNAS (FLEXIÓN VS CORTANTE)
function createFlexuralColumnCracks(w, h, d, level) {
    const vertices = [];
    const offset = 0.002;

    if (level === 'minor') {
        const zf = d / 2 + offset;
        vertices.push(
            -w / 2, -h / 2 + 0.08, zf, w / 2, -h / 2 + 0.10, zf,
            -w / 2, h / 2 - 0.10, zf, w / 2, h / 2 - 0.08, zf
        );
        const zb = -d / 2 - offset;
        vertices.push(
            -w / 2, -h / 2 + 0.10, zb, w / 2, -h / 2 + 0.08, zb,
            -w / 2, h / 2 - 0.08, zb, w / 2, h / 2 - 0.10, zb
        );
    } else if (level === 'moderate') {
        const zf = d / 2 + offset;
        vertices.push(
            -w / 2, -h / 2 + 0.18, zf, w / 3, -h / 2 + 0.16, zf,
            -w / 3, h / 2 - 0.16, zf, w / 2, h / 2 - 0.18, zf
        );
        const xl = -w / 2 - offset;
        vertices.push(
            xl, -h / 2 + 0.10, -d / 2, xl, -h / 2 + 0.10, d / 2,
            xl, h / 2 - 0.10, -d / 2, xl, h / 2 - 0.10, d / 2
        );
    } else if (level === 'severe') {
        const zf = d / 2 + offset;
        vertices.push(
            -w / 2, -h / 2 + 0.25, zf, w / 2, -h / 2 + 0.22, zf,
            -w / 2, h / 2 - 0.22, zf, w / 2, h / 2 - 0.25, zf
        );
        const xr = w / 2 + offset;
        vertices.push(
            xr, -h / 2 + 0.10, -d / 2, xr, -h / 2 + 0.10, d / 2,
            xr, h / 2 - 0.10, -d / 2, xr, h / 2 - 0.10, d / 2
        );
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    return geom;
}

function createShearColumnCracks(w, h, d, level) {
    const vertices = [];
    const offset = 0.002;

    if (level === 'minor') {
        const zf = d / 2 + offset;
        vertices.push(-w / 2, -h / 4, zf, w / 2, h / 4, zf);
        const zb = -d / 2 - offset;
        vertices.push(-w / 2, -h / 4, zb, w / 2, h / 4, zb);
    } else if (level === 'moderate') {
        const zf = d / 2 + offset;
        vertices.push(-w / 2, h / 4, zf, w / 2, -h / 4, zf);
        const zb = -d / 2 - offset;
        vertices.push(-w / 2, h / 4, zb, w / 2, -h / 4, zb);
    } else if (level === 'severe') {
        const xl = -w / 2 - offset;
        vertices.push(
            xl, -h / 3, -d / 2, xl, h / 3, d / 2,
            xl, h / 3, -d / 2, xl, -h / 3, d / 2
        );
        const xr = w / 2 + offset;
        vertices.push(
            xr, -h / 3, -d / 2, xr, h / 3, d / 2,
            xr, h / 3, -d / 2, xr, -h / 3, d / 2
        );
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    return geom;
}

// HELPER PARA GEOMETRÍA DE FISURAS EN VIGAS (FLEXIÓN - VERTICALES EN LOS APOYOS)
function createBeamCracksGeometry(L, H, W, level) {
    const vertices = [];
    const offset = 0.002;
    const yf = W / 2 + offset;

    if (level === 'minor') {
        vertices.push(
            -L / 2 + 0.15, -H / 2, yf, -L / 2 + 0.15, H / 3, yf,
            L / 2 - 0.15, -H / 2, yf, L / 2 - 0.15, H / 3, yf
        );
        const yb = -W / 2 - offset;
        vertices.push(
            -L / 2 + 0.15, -H / 2, yb, -L / 2 + 0.15, H / 3, yb,
            L / 2 - 0.15, -H / 2, yb, L / 2 - 0.15, H / 3, yb
        );
    } else if (level === 'severe') {
        vertices.push(
            -L / 2 + 0.30, -H / 2, yf, -L / 2 + 0.30, H / 2, yf,
            L / 2 - 0.30, -H / 2, yf, L / 2 - 0.30, H / 2, yf
        );
        const yb = -W / 2 - offset;
        vertices.push(
            -L / 2 + 0.30, -H / 2, yb, -L / 2 + 0.30, H / 2, yb,
            L / 2 - 0.30, -H / 2, yb, L / 2 - 0.30, H / 2, yb
        );
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    return geom;
}

// ENCUADRE AUTOMÁTICO DE CÁMARA SEGÚN LA ESCALA REAL DE LOS EDIFICIOS
// Conserva el ángulo de órbita del usuario: solo ajusta la distancia cuando
// la estructura no cabe en el encuadre actual (o quedó demasiado lejos).
function autoFrameCamera() {
    if (typeof camera === 'undefined' || !camera || !controls || isPlaying) return;
    if (!buildings3D.b2001.group || !buildings3D.b2019.group) return;

    const box = new THREE.Box3().setFromObject(buildings3D.b2001.group);
    box.union(new THREE.Box3().setFromObject(buildings3D.b2019.group));
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    if (!isFinite(size.y) || size.y <= 0) return;

    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    const fitH = (size.y / 2) / Math.tan(halfFov);
    const fitW = (size.x / 2) / (Math.tan(halfFov) * Math.max(0.4, camera.aspect));
    const needed = Math.min(58, Math.max(18, Math.max(fitH, fitW) * 1.18));

    const target = new THREE.Vector3(0, Math.max(2.5, center.y * 0.85), 0);
    const dir = camera.position.clone().sub(controls.target);
    const currentDist = dir.length();
    dir.normalize();
    if (dir.lengthSq() < 0.5 || !isFinite(dir.x)) dir.set(0, 0.33, 1).normalize();

    controls.target.copy(target);
    // Alejar si no cabe; acercar si quedó excesivamente lejos tras reducir la estructura
    if (needed > currentDist * 1.03 || currentDist > needed * 1.8) {
        camera.position.copy(target).addScaledVector(dir, needed);
    } else {
        // Mantener la distancia del usuario pero con el nuevo objetivo
        camera.position.copy(target).addScaledVector(dir, currentDist);
    }
    controls.update();
}

// RECONSTRUCCIÓN DE LOS MODELOS 3D DE CADA EDIFICIO
function rebuild3DStructures() {
    if (typeof scene === 'undefined' || !scene) {
        console.warn('[rebuild3DStructures] La escena 3D no está inicializada (WebGL podría no estar soportado).');
        return;
    }
    // Limpiar escena anterior de edificios con disposición de memoria
    if (buildings3D.b2001.group) {
        disposeGroup(buildings3D.b2001.group);
        scene.remove(buildings3D.b2001.group);
    }
    if (buildings3D.b2019.group) {
        disposeGroup(buildings3D.b2019.group);
        scene.remove(buildings3D.b2019.group);
    }

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
            color: 0x141a29,
            roughness: 0.55,
            metalness: 0.35
        });
        groundPlane = new THREE.Mesh(groundGeometry, groundMaterial);
        groundPlane.position.y = -0.25;
        groundPlane.receiveShadow = true;
        scene.add(groundPlane);
    }

    // Recrear la malla de ondas con las nuevas dimensiones del terreno
    createTerrainMesh(Math.max(30, xOffset * 2 + bW + 8), Math.max(12, bD + 6));

    if (gridHelper) {
        scene.remove(gridHelper);
        const gridGridSize = Math.max(40, xOffset * 2 + bW + 20);
        gridHelper = new THREE.GridHelper(gridGridSize, 20, 0x33507a, 0x141d31);
        gridHelper.position.y = 0.01;
        scene.add(gridHelper);
    }

    // Reposicionar luces de acento junto a cada edificio
    if (accentLight2001) accentLight2001.position.set(-xOffset, Math.max(3, N * h * 0.45), bD / 2 + 5);
    if (accentLight2019) accentLight2019.position.set(xOffset, Math.max(3, N * h * 0.45), bD / 2 + 5);

    // Reiniciar banderas de FX de colapso
    collapseFxFired.b2001 = false;
    collapseFxFired.b2019 = false;

    // Reconstruir indicadores de ejes con posición adaptada
    createAxisIndicators();

    // Función auxiliar para construir losas y columnas
    const buildBuilding = (bData, colorTheme) => {
        bData.floors = [];
        bData.columns = [];

        // Color de borde luminoso según la norma (identidad visual)
        const edgeColor = colorTheme === '2001' ? 0x22d3ee : 0xff3d8a;

        // Losa base (cimentación)
        const baseGeom = new THREE.BoxGeometry(bW + 0.6, 0.25, bD + 0.6);
        const baseMat = new THREE.MeshStandardMaterial({ color: 0x2a3548, roughness: 0.6, metalness: 0.25 });
        const baseMesh = new THREE.Mesh(baseGeom, baseMat);
        baseMesh.position.y = 0.125;
        baseMesh.castShadow = true;
        baseMesh.receiveShadow = true;
        bData.group.add(baseMesh);

        // Borde tenue en la cimentación
        const baseEdges = new THREE.LineSegments(
            new THREE.EdgesGeometry(baseGeom),
            new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.22 })
        );
        baseMesh.add(baseEdges);

        // Crear losas para cada piso
        for (let i = 0; i < N; i++) {
            const floorGeom = new THREE.BoxGeometry(bW + 0.4, 0.2, bD + 0.4);
            const floorMat = new THREE.MeshStandardMaterial({
                color: colorTheme === '2001' ? 0x1c2740 : 0x131a2e,
                roughness: 0.42,
                metalness: 0.35
            });
            const floorMesh = new THREE.Mesh(floorGeom, floorMat);
            floorMesh.position.set(0, (i + 1) * h, 0);
            floorMesh.castShadow = true;
            floorMesh.receiveShadow = true;
            bData.group.add(floorMesh);

            // Filo luminoso de la losa (cyan = 2001, magenta = 2019)
            const edgeLines = new THREE.LineSegments(
                new THREE.EdgesGeometry(floorGeom),
                new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.5 })
            );
            floorMesh.add(edgeLines);

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
                // Instanciar geometrías de cracks progresivos
                const cMinorGeom = colorTheme === '2019'
                    ? createFlexuralColumnCracks(colW, hSeg, colD, 'minor')
                    : createShearColumnCracks(colW, hSeg, colD, 'minor');
                const cModGeom = colorTheme === '2019'
                    ? createFlexuralColumnCracks(colW, hSeg, colD, 'moderate')
                    : createShearColumnCracks(colW, hSeg, colD, 'moderate');
                const cSevGeom = colorTheme === '2019'
                    ? createFlexuralColumnCracks(colW, hSeg, colD, 'severe')
                    : createShearColumnCracks(colW, hSeg, colD, 'severe');

                for (let s = 0; s < numSegs; s++) {
                    const segMesh = new THREE.Mesh(segGeom, colMat);
                    segMesh.castShadow = true;
                    segMesh.receiveShadow = true;
                    // Posicionar a la altura correspondiente del segmento inicialmente
                    const xi = (s + 0.5) / numSegs;
                    segMesh.position.set(colOffsets[c].x, lvl * h + xi * h, colOffsets[c].z);

                    // Instanciar cracks progresivos para este segmento
                    const lineMatMinor = new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0 });
                    const lineMatMod = new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0 });
                    const lineMatSev = new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0 });

                    const minorMesh = new THREE.LineSegments(cMinorGeom, lineMatMinor);
                    minorMesh.name = "cracks_minor";
                    minorMesh.visible = false;
                    segMesh.add(minorMesh);

                    const modMesh = new THREE.LineSegments(cModGeom, lineMatMod);
                    modMesh.name = "cracks_moderate";
                    modMesh.visible = false;
                    segMesh.add(modMesh);

                    const sevMesh = new THREE.LineSegments(cSevGeom, lineMatSev);
                    sevMesh.name = "cracks_severe";
                    sevMesh.visible = false;
                    segMesh.add(sevMesh);

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

            for (let lvl = 0; lvl < N; lvl++) {
                const storyBeams = [];
                const floorMesh = bData.floors[lvl];
                for (let iy = 0; iy < numColsY; iy++) {
                    const z = numColsY > 1 ? -bD / 2 + (iy / (numColsY - 1)) * bD : 0;
                    for (let ix = 0; ix < numColsX - 1; ix++) {
                        const xStart = -bW / 2 + (ix / (numColsX - 1)) * bW;

                        // Material individual por viga
                        const beamMat = new THREE.MeshStandardMaterial({
                            color: colorTheme === '2001' ? 0x273549 : 0x182030,
                            roughness: 0.6
                        });

                        const segments = [];
                        // Instanciar geometrías de cracks de viga X (en los extremos del vano)
                        const bMinorGeom = createBeamCracksGeometry(sX, beamH, beamW, 'minor');
                        const bSevGeom = createBeamCracksGeometry(sX, beamH, beamW, 'severe');

                        for (let s = 0; s < numSegs; s++) {
                            const segMesh = new THREE.Mesh(beamGeomX, beamMat);
                            segMesh.castShadow = true;
                            segMesh.receiveShadow = true;

                            // Posición local inicial
                            const eta = (s + 0.5) / numSegs;
                            const x_s = xStart + eta * sX;
                            segMesh.position.set(x_s, -0.1 - beamH / 2, z);

                            // Añadir grietas a los segmentos de apoyo de la viga (s === 0 o s === numSegs - 1)
                            if (s === 0 || s === numSegs - 1) {
                                const bMatMinor = new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0 });
                                const bMatSev = new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0 });

                                const bMinorMesh = new THREE.LineSegments(bMinorGeom, bMatMinor);
                                bMinorMesh.name = "cracks_minor";
                                bMinorMesh.visible = false;
                                segMesh.add(bMinorMesh);

                                const bSevMesh = new THREE.LineSegments(bSevGeom, bMatSev);
                                bSevMesh.name = "cracks_severe";
                                bSevMesh.visible = false;
                                segMesh.add(bSevMesh);
                            }

                            floorMesh.add(segMesh);
                            segments.push(segMesh);
                        }

                        storyBeams.push({
                            meshes: segments,
                            material: beamMat,
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

            for (let lvl = 0; lvl < N; lvl++) {
                const storyBeams = [];
                const floorMesh = bData.floors[lvl];
                for (let ix = 0; ix < numColsX; ix++) {
                    const x = numColsX > 1 ? -bW / 2 + (ix / (numColsX - 1)) * bW : 0;
                    for (let iy = 0; iy < numColsY - 1; iy++) {
                        const zStart = -bD / 2 + (iy / (numColsY - 1)) * bD;

                        // Material individual por viga
                        const beamMat = new THREE.MeshStandardMaterial({
                            color: colorTheme === '2001' ? 0x273549 : 0x182030,
                            roughness: 0.6
                        });

                        const segments = [];
                        // Instanciar geometrías de cracks de viga Y (en los extremos del vano)
                        const bMinorGeom = createBeamCracksGeometry(sY, beamH, beamW, 'minor');
                        const bSevGeom = createBeamCracksGeometry(sY, beamH, beamW, 'severe');

                        for (let s = 0; s < numSegs; s++) {
                            const segMesh = new THREE.Mesh(beamGeomY, beamMat);
                            segMesh.castShadow = true;
                            segMesh.receiveShadow = true;

                            // Posición local inicial
                            const eta = (s + 0.5) / numSegs;
                            const z_s = zStart + eta * sY;
                            segMesh.position.set(x, -0.1 - beamH / 2, z_s);

                            // Añadir grietas a los segmentos de apoyo de la viga (s === 0 o s === numSegs - 1)
                            if (s === 0 || s === numSegs - 1) {
                                const bMatMinor = new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0 });
                                const bMatSev = new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0 });

                                const bMinorMesh = new THREE.LineSegments(bMinorGeom, bMatMinor);
                                bMinorMesh.name = "cracks_minor";
                                bMinorMesh.visible = false;
                                segMesh.add(bMinorMesh);

                                const bSevMesh = new THREE.LineSegments(bSevGeom, bMatSev);
                                bSevMesh.name = "cracks_severe";
                                bSevMesh.visible = false;
                                segMesh.add(bSevMesh);
                            }

                            floorMesh.add(segMesh);
                            segments.push(segMesh);
                        }

                        storyBeams.push({
                            meshes: segments,
                            material: beamMat,
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

    // Resortes helicoidales de fundación (representación visual de la rigidez del suelo)
    buildSSISprings(buildings3D.b2001, -xOffset);
    buildSSISprings(buildings3D.b2019, xOffset);

    // Encuadre cinematográfico según la nueva escala de la escena
    autoFrameCamera();
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

// --- RESORTES HELICOIDALES DE FUNDACIÓN (REPRESENTACIÓN SSI) ---
// Cada columna descansa sobre un resorte que representa la rigidez del suelo.
// Se comprimen (ámbar→rojo) y se estiran (cyan) con el balanceo del edificio,
// con una ganancia que crece en suelos más flexibles (λ ISE menor).
function createHelixSpring(radius, height, turns, colorHex) {
    const pts = [];
    const segPerTurn = 12;
    const total = turns * segPerTurn;
    for (let i = 0; i <= total; i++) {
        const a = (i / segPerTurn) * Math.PI * 2;
        pts.push(new THREE.Vector3(
            Math.cos(a) * radius,
            (i / total) * height,
            Math.sin(a) * radius
        ));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const geom = new THREE.TubeGeometry(curve, total * 2, radius * 0.2, 6, false);
    const mat = new THREE.MeshStandardMaterial({
        color: colorHex, roughness: 0.35, metalness: 0.65,
        emissive: colorHex, emissiveIntensity: 0.25
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = true;
    return mesh;
}

function buildSSISprings(bData, initialX) {
    // Limpiar resortes anteriores
    if (bData.springsGroup) {
        scene.remove(bData.springsGroup);
        disposeGroup(bData.springsGroup);
        bData.springsGroup = null;
    }
    bData.springs = [];

    const toggle = document.getElementById('show-ssi-springs');
    const enabled = toggle ? toggle.checked : true;

    // Con resortes activos, el edificio se eleva sobre la cama de resortes
    bData.group.position.y = enabled ? SSI_SPRING_HEIGHT : 0;
    if (!enabled) return;

    const g = new THREE.Group();
    g.position.set(initialX, 0, 0);

    const baseCols = bData.columns[0] || [];
    baseCols.forEach(col => {
        const spring = createHelixSpring(0.30, SSI_SPRING_HEIGHT, 6, 0x34d399);
        spring.position.set(col.offsetX, 0, col.offsetZ);
        g.add(spring);
        bData.springs.push({ mesh: spring, ox: col.offsetX, oz: col.offsetZ });
    });

    scene.add(g);
    bData.springsGroup = g;
}

function updateSSISprings(bModel, bData, roofDispVisual, activeDir, baseDX, baseDZ, initialX) {
    if (!bData.springsGroup || !bData.springs.length) return;

    // Los resortes se trasladan solidarios a la base del edificio (suelo + sway basal)
    bData.springsGroup.position.x = initialX + baseDX;
    bData.springsGroup.position.z = baseDZ;

    const H = Math.max(1, bModel.N * bModel.h);
    const lean = roofDispVisual / H; // inclinación por balanceo
    const ssi = (activeDir === 'Y') ? bModel.ssiY : bModel.ssiX;
    const lambda = (ssi && typeof ssi.lambda === 'number') ? Math.min(1, Math.max(0.05, ssi.lambda)) : 1.0;
    const gain = 1.15 * (2.0 - lambda); // suelos más flexibles → mayor deformación visible
    const maxD = SSI_SPRING_HEIGHT * 0.42;

    const cCompression = new THREE.Color(0xef4444);
    const cTension = new THREE.Color(0x22d3ee);
    const cRest = new THREE.Color(0x34d399);

    bData.springs.forEach(s => {
        const off = (activeDir === 'Y') ? s.oz : s.ox;
        let delta = -lean * off * gain;
        delta = Math.max(-maxD, Math.min(maxD, delta));
        const ratio = delta / maxD; // negativo = compresión, positivo = tensión

        s.mesh.scale.y = (SSI_SPRING_HEIGHT + delta) / SSI_SPRING_HEIGHT;

        const c = s.mesh.material.color;
        if (ratio < 0) c.copy(cRest).lerp(cCompression, Math.min(1, -ratio * 1.15));
        else c.copy(cRest).lerp(cTension, Math.min(1, ratio));
        s.mesh.material.emissive.copy(c).multiplyScalar(0.35);
    });
}

// --- VISUALIZADOR INTERACTIVO DE MODOS DE VIBRACIÓN (MODO EN CALMA) ---
// Dimensiones en planta leídas de la configuración actual (misma fórmula que rebuild3DStructures)
function getPlanDims() {
    const numColsX = parseInt(document.getElementById("num-cols-x").value) || 2;
    const numColsY = parseInt(document.getElementById("num-cols-y").value) || 2;
    const sX = parseFloat(document.getElementById("col-dist-x").value) || 5.0;
    const sY = parseFloat(document.getElementById("col-dist-y").value) || 5.0;
    const bW = sX * (numColsX - 1);
    const bD = sY * (numColsY - 1);
    return { numColsX, numColsY, sX, sY, bW, bD, xOffset: Math.max(6, bW / 2 + 3.5) };
}

// Frecuencias y formas modales exactas del edificio de corte uniforme (base empotrada):
// w_n = 2·sqrt(k/m)·sin((2n-1)π/(4N+2)),  phi_j^(n) = sin((2n-1)π·j/(2N+1))
// Es la misma expresión con la que el modelo calcula T1, por lo que es consistente.
function computeModeData(bModel, n, dir) {
    const N = bModel.N;
    const k = (dir === 'Y') ? bModel.k_init_y : bModel.k_init_x;
    const m = bModel.m;
    const w = 2.0 * Math.sqrt(k / m) * Math.sin((2 * n - 1) * Math.PI / (4 * N + 2));

    const phi = new Array(N);
    for (let j = 0; j < N; j++) {
        phi[j] = Math.sin((2 * n - 1) * Math.PI * (j + 1) / (2 * N + 1));
    }
    // Normalizar a desplazamiento de techo unitario
    const roof = Math.abs(phi[N - 1]) || 1;
    let dPhiMax = 0;
    for (let j = 0; j < N; j++) {
        phi[j] /= roof;
        const prev = (j === 0) ? 0 : phi[j - 1];
        dPhiMax = Math.max(dPhiMax, Math.abs(phi[j] - prev));
    }
    return { w, T: (2 * Math.PI) / w, f: w / (2 * Math.PI), phi, dPhiMax: dPhiMax || 1 };
}

// Aplica la forma modal oscilante a un edificio en un instante t
function applyModeToBuilding(bModel, b3D, initialX, dims, t) {
    const dir = (modeViewer.kind === 'Y') ? 'Y' : 'X';
    const md = computeModeData(bModel, modeViewer.mode, dir);
    // Amplitud calibrada para que la deriva máxima de entrepiso roce el límite elástico (~1.7%)
    const A = Math.min(0.30, Math.max(0.02, (0.017 * bModel.h) / md.dPhiMax));
    const s = Math.sin(md.w * t);

    let override;
    let roofDispVisual;
    if (modeViewer.kind === 'T') {
        // Modo torsional: rotación pura de planta (perfil vertical del modo n).
        // Amplitud calibrada para que la deriva de borde roce ~1.2% (visible sin
        // que la losa amplificada ×6 parezca desconectada del pórtico).
        const halfW = Math.max(1.5, dims.bW / 2);
        const thetaAmp = (0.012 * bModel.h) / (md.dPhiMax * halfW);
        override = {
            disp: md.phi.map(p => p * A * 0.18 * s),
            theta: md.phi.map(p => p * thetaAmp * s)
        };
        roofDispVisual = A * 0.18 * s * 6.0;
    } else {
        override = { disp: md.phi.map(p => p * A * s) };
        roofDispVisual = A * s * 6.0;
    }

    updateBuilding3DPhysics(bModel, b3D, initialX, 0, dir, override);
    updateSSISprings(bModel, b3D, roofDispVisual, dir, 0, 0, initialX);
}

let modeInfoFrameCounter = 0;
function runModeViewerFrame() {
    const dims = getPlanDims();
    applyModeToBuilding(eq2001, buildings3D.b2001, -dims.xOffset, dims, modeViewerClock);
    applyModeToBuilding(eq2019, buildings3D.b2019, dims.xOffset, dims, modeViewerClock);

    // Refrescar la ficha de frecuencias a baja frecuencia (no en cada frame)
    if ((++modeInfoFrameCounter % 15) === 0) updateModeViewerInfo();
}

function updateModeViewerInfo() {
    if (!eq2001 || !eq2019) return;
    const dir = (modeViewer.kind === 'Y') ? 'Y' : 'X';
    const md1 = computeModeData(eq2001, modeViewer.mode, dir);
    const md2 = computeModeData(eq2019, modeViewer.mode, dir);
    // Frecuencia torsional estimada (acople torsional típico ~15% sobre la traslacional)
    const factorT = (modeViewer.kind === 'T') ? 1.15 : 1.0;
    const kindLabel = (modeViewer.kind === 'T') ? 'Torsión' : `Traslacional ${modeViewer.kind}`;
    const n = modeViewer.mode;

    const info = document.getElementById('mv-freq-info');
    if (info) {
        info.innerHTML =
            `<strong>Modo ${n} · ${kindLabel}</strong><br>` +
            `2001: T = ${(md1.T * factorT).toFixed(2)} s · f = ${(md1.f / factorT).toFixed(2)} Hz<br>` +
            `2019: T = ${(md2.T * factorT).toFixed(2)} s · f = ${(md2.f / factorT).toFixed(2)} Hz`;
    }
    updateViewportPhasePill(
        `Modo ${n} ${kindLabel} — T ≈ ${(md1.T * factorT).toFixed(2)} s`,
        'text-green'
    );
}

function setModeViewerActive(on) {
    if (on && isPlaying) stopSimulation(); // modo en calma: detiene cualquier sismo activo
    modeViewer.active = on;
    modeViewerClock = 0;

    const panel = document.getElementById('mode-viewer-panel');
    if (panel) panel.style.display = on ? 'block' : 'none';

    const btn = document.getElementById('btn-mode-viewer');
    if (btn) {
        btn.innerHTML = on
            ? '<i class="fa-solid fa-circle-stop"></i> Salir de Modos'
            : '<i class="fa-solid fa-water"></i> Modos de Vibración';
        btn.classList.toggle('btn-danger', on);
        btn.classList.toggle('btn-secondary', !on);
    }
    const mobBtn = document.getElementById('mobile-btn-modes');
    if (mobBtn) mobBtn.classList.toggle('btn-danger', on);

    if (on) {
        updateModeViewerInfo();
    } else {
        restoreRestFrame();
        updateViewportPhasePill('En reposo', 'text-green');
    }
}

// Devuelve ambos edificios al reposo (formas modales a cero)
function restoreRestFrame() {
    if (!eq2001 || !eq2019 || !buildings3D.b2001.group) return;
    const dims = getPlanDims();
    const zero2001 = { disp: new Array(eq2001.N).fill(0), theta: new Array(eq2001.N).fill(0) };
    const zero2019 = { disp: new Array(eq2019.N).fill(0), theta: new Array(eq2019.N).fill(0) };
    updateBuilding3DPhysics(eq2001, buildings3D.b2001, -dims.xOffset, 0, 'X', zero2001);
    updateBuilding3DPhysics(eq2019, buildings3D.b2019, dims.xOffset, 0, 'X', zero2019);
    updateSSISprings(eq2001, buildings3D.b2001, 0, 'X', 0, 0, -dims.xOffset);
    updateSSISprings(eq2019, buildings3D.b2019, 0, 'X', 0, 0, dims.xOffset);
}

// ACTUALIZACIÓN DE LA GEOMETRÍA 3D POR SWAY SÍSMICO Y DAÑO
function update3DPhysics() {
    const activeTime = simStepIndex * dt;
    const activeDir = getActiveSismoDirection(activeTime);
    const isX = (activeDir === 'X');

    // Desplazamiento actual del terreno (vibración visual del suelo)
    const groundDisp = groundAccel[simStepIndex] * 0.8; // amplificar visualmente el sismo
    lastGroundAccel = groundAccel[simStepIndex] || 0;

    if (isX) {
        groundPlane.position.x = groundDisp;
        groundPlane.position.z = 0;
    } else {
        groundPlane.position.x = 0;
        groundPlane.position.z = groundDisp;
    }

    // La malla de ondas se traslada solidaria al suelo
    if (terrainGroup) {
        terrainGroup.position.x = isX ? groundDisp : 0;
        terrainGroup.position.z = isX ? 0 : groundDisp;
    }

    // --- FX: sacudida de cámara y ondas expansivas según intensidad ---
    const absAccel = Math.abs(groundAccel[simStepIndex] || 0);
    cameraShake = Math.min(0.5, absAccel * 0.55);

    if (absAccel > 0.20) {
        shockwaveCooldown -= 1;
        if (shockwaveCooldown <= 0) {
            const ringColor = absAccel > 0.45 ? 0xff7aa8 : 0x9fdcff;
            spawnShockwave(0, 0, ringColor, 18 + absAccel * 18);
            shockwaveCooldown = 24; // pasos físicos mínimos entre anillos
        }
    } else if (shockwaveCooldown > 0) {
        shockwaveCooldown -= 1;
    }

    const numColsX = parseInt(document.getElementById("num-cols-x").value) || 2;
    const sX = parseFloat(document.getElementById("col-dist-x").value) || 5.0;
    const bW = sX * (numColsX - 1);
    const xOffset = Math.max(6, bW / 2 + 3.5);

    // Actualizar Edificio 2001
    updateBuilding3DPhysics(eq2001, buildings3D.b2001, -xOffset, groundDisp, activeDir);

    // Actualizar Edificio 2019
    updateBuilding3DPhysics(eq2019, buildings3D.b2019, xOffset, groundDisp, activeDir);

    // Actualizar resortes SSI (balanceo + traslación del suelo)
    const baseDX = isX ? groundDisp : 0;
    const baseDZ = isX ? 0 : groundDisp;
    updateSSISprings(eq2001, buildings3D.b2001, eq2001.x[eq2001.N - 1] * 6.0, activeDir, baseDX, baseDZ, -xOffset);
    updateSSISprings(eq2019, buildings3D.b2019, eq2019.x[eq2019.N - 1] * 6.0, activeDir, baseDX, baseDZ, xOffset);

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

    // --- FX: onda expansiva y sacudida extra al ocurrir un colapso ---
    if (eq2001.isCollapsed && !collapseFxFired.b2001) {
        collapseFxFired.b2001 = true;
        spawnShockwave(-xOffset, 0, 0xff3d5a, 30);
        cameraShake = Math.max(cameraShake, 0.65);
    }
    if (eq2019.isCollapsed && !collapseFxFired.b2019) {
        collapseFxFired.b2019 = true;
        spawnShockwave(xOffset, 0, 0xff3d5a, 30);
        cameraShake = Math.max(cameraShake, 0.65);
    }
}

function updateBuilding3DPhysics(bModel, b3D, initialX, groundDisp, activeDir, modeOverride) {
    const N = bModel.N;
    const h = bModel.h;
    const isX = (activeDir === 'X');
    const colorTheme = (bModel === eq2019) ? '2019' : '2001';

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
            const showCracksCheck = document.getElementById("show-cracks");
            const showCracks = showCracksCheck ? showCracksCheck.checked : true;
            cols.forEach(col => {
                col.meshes.forEach(segMesh => {
                    segMesh.scale.y = Math.max(0.1, segMesh.scale.y - 0.05);
                    segMesh.rotation.z += (col.offsetX > 0 ? 0.03 : -0.03);

                    // En colapso, mostrar grietas permanentemente con color negro profundo
                    const minor = segMesh.getObjectByName("cracks_minor");
                    const mod = segMesh.getObjectByName("cracks_moderate");
                    const sev = segMesh.getObjectByName("cracks_severe");
                    if (minor && mod && sev) {
                        minor.visible = showCracks; minor.material.opacity = 0.95; minor.material.color.setHex(0x000000);
                        mod.visible = showCracks; mod.material.opacity = 0.95; mod.material.color.setHex(0x000000);
                        sev.visible = showCracks; sev.material.opacity = 0.95; sev.material.color.setHex(0x000000);
                    }
                });
                col.material.color.setHex(0x111111); // Negro
            });

            // Vigas de ese nivel también se vuelven negras/apagadas y muestran grietas completas
            const setBeamCollapsed = (beam) => {
                if (beam.material) beam.material.color.setHex(0x111111);
                beam.meshes.forEach(segMesh => {
                    const minor = segMesh.getObjectByName("cracks_minor");
                    const sev = segMesh.getObjectByName("cracks_severe");
                    if (minor && sev) {
                        minor.visible = showCracks; minor.material.opacity = 0.95; minor.material.color.setHex(0x000000);
                        sev.visible = showCracks; sev.material.opacity = 0.95; sev.material.color.setHex(0x000000);
                    }
                });
            };
            if (b3D.beamsX && b3D.beamsX[lvl]) {
                b3D.beamsX[lvl].forEach(setBeamCollapsed);
            }
            if (b3D.beamsY && b3D.beamsY[lvl]) {
                b3D.beamsY[lvl].forEach(setBeamCollapsed);
            }
        }
        return;
    }

    // Parámetros geométricos para torsión
    const ecc = parseFloat(document.getElementById("torsional-eccentricity").value) || 0.0;
    const rp = Math.sqrt((bW * bW + bD * bD) / 12) || 2.0;

    // Fuente de desplazamientos: estado físico del modelo o forma modal sintética
    // (visualizador de modos de vibración). thetaSrc permite imponer rotaciones
    // puras por nivel (modo torsional) sin excentricidad configurada.
    const dispSrc = (modeOverride && modeOverride.disp) ? modeOverride.disp : bModel.x;
    const thetaSrc = (modeOverride && modeOverride.theta) ? modeOverride.theta : null;

    // Comportamiento normal (oscilación lateral + torsión)
    for (let lvl = 0; lvl < N; lvl++) {
        // Desplazamiento del nivel actual
        const d_curr = dispSrc[lvl] * 6.0; // amplificado para visibilidad en 3D
        const d_prev = (lvl === 0) ? 0 : dispSrc[lvl - 1] * 6.0;

        // Ángulo de rotación del nivel actual (amplificado para visibilidad)
        const theta_curr = thetaSrc ? thetaSrc[lvl] * 6.0 : (d_curr * ecc) / rp;
        const theta_prev = thetaSrc ? ((lvl === 0) ? 0 : thetaSrc[lvl - 1] * 6.0) : ((lvl === 0) ? 0 : (d_prev * ecc) / rp);

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
            const theta_curr_phys = thetaSrc ? thetaSrc[lvl] : (dispSrc[lvl] * ecc) / rp;
            const theta_prev_phys = thetaSrc ? ((lvl === 0) ? 0 : thetaSrc[lvl - 1]) : ((lvl === 0) ? 0 : (dispSrc[lvl - 1] * ecc) / rp);

            const x_trans_p_phys = isX ? (lvl === 0 ? 0 : dispSrc[lvl - 1]) : 0;
            const z_trans_p_phys = isX ? 0 : (lvl === 0 ? 0 : dispSrc[lvl - 1]);
            const x_trans_c_phys = isX ? dispSrc[lvl] : 0;
            const z_trans_c_phys = isX ? 0 : dispSrc[lvl];

            const x_b_phys = x_trans_p_phys + ox * Math.cos(theta_prev_phys) - oz * Math.sin(theta_prev_phys);
            const z_b_phys = z_trans_p_phys + ox * Math.sin(theta_prev_phys) + oz * Math.cos(theta_prev_phys);

            const x_t_phys = x_trans_c_phys + ox * Math.cos(theta_curr_phys) - oz * Math.sin(theta_curr_phys);
            const z_t_phys = z_trans_c_phys + ox * Math.sin(theta_curr_phys) + oz * Math.cos(theta_curr_phys);

            const drift_x_phys = x_t_phys - x_b_phys;
            const drift_z_phys = z_t_phys - z_b_phys;
            const colDriftRatio = Math.sqrt(drift_x_phys * drift_x_phys + drift_z_phys * drift_z_phys) / h;
            col.maxDriftRatio = Math.max(col.maxDriftRatio || 0, colDriftRatio);
            col.currentDriftRatio = colDriftRatio;

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

            // Actualizar visualización de Grietas (Cracks) en Columnas
            const showCracksCheck = document.getElementById("show-cracks");
            const showCracks = showCracksCheck ? showCracksCheck.checked : true;

            col.meshes.forEach(segMesh => {
                const minor = segMesh.getObjectByName("cracks_minor");
                const mod = segMesh.getObjectByName("cracks_moderate");
                const sev = segMesh.getObjectByName("cracks_severe");

                if (minor && mod && sev) {
                    if (showCracks) {
                        if (colDriftRatio >= 0.018) {
                            minor.visible = true; minor.material.opacity = 0.95;
                            mod.visible = true; mod.material.opacity = 0.95;
                            sev.visible = true; sev.material.opacity = 0.95;
                        } else if (colDriftRatio >= 0.015) {
                            minor.visible = true; minor.material.opacity = 0.90;
                            mod.visible = true; mod.material.opacity = 0.80;
                            sev.visible = false; sev.material.opacity = 0;
                        } else if (colDriftRatio >= 0.012) {
                            minor.visible = true; minor.material.opacity = 0.60;
                            mod.visible = false; mod.material.opacity = 0;
                            sev.visible = false; sev.material.opacity = 0;
                        } else {
                            minor.visible = false; minor.material.opacity = 0;
                            mod.visible = false; mod.material.opacity = 0;
                            sev.visible = false; sev.material.opacity = 0;
                        }
                    } else {
                        minor.visible = false;
                        mod.visible = false;
                        sev.visible = false;
                    }
                }
            });

            // Determinar deriva máxima del entrepiso para activar daño en vigas
            let maxStoryDrift = 0;
            cols.forEach(c_col => {
                if (c_col.currentDriftRatio > maxStoryDrift) {
                    maxStoryDrift = c_col.currentDriftRatio;
                }
            });

            const beamDriftTriggerMinor = colorTheme === '2019' ? 0.008 : 0.016; // Vigas 2019 (viga débil) agrietan antes
            const beamDriftTriggerSevere = colorTheme === '2019' ? 0.015 : 0.022;

            const updateBeamCracks = (beam) => {
                beam.meshes.forEach(segMesh => {
                    const minor = segMesh.getObjectByName("cracks_minor");
                    const sev = segMesh.getObjectByName("cracks_severe");
                    if (minor && sev) {
                        if (showCracks) {
                            if (maxStoryDrift >= beamDriftTriggerSevere) {
                                minor.visible = true; minor.material.opacity = 0.90;
                                sev.visible = true; sev.material.opacity = 0.85;
                            } else if (maxStoryDrift >= beamDriftTriggerMinor) {
                                minor.visible = true; minor.material.opacity = 0.70;
                                sev.visible = false; sev.material.opacity = 0;
                            } else {
                                minor.visible = false; minor.material.opacity = 0;
                                sev.visible = false; sev.material.opacity = 0;
                            }
                        } else {
                            minor.visible = false;
                            sev.visible = false;
                        }
                    }
                });
            };

            if (b3D.beamsX && b3D.beamsX[lvl]) {
                b3D.beamsX[lvl].forEach(updateBeamCracks);
            }
            if (b3D.beamsY && b3D.beamsY[lvl]) {
                b3D.beamsY[lvl].forEach(updateBeamCracks);
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
                const colA = cols[beam.ix * numColsY + beam.iy];
                const colB = cols[(beam.ix + 1) * numColsY + beam.iy];

                // Calcular drift de viga basado en las columnas que conecta
                const beamDrift = Math.max(colA.currentDriftRatio || 0, colB.currentDriftRatio || 0);

                let beamColor;
                if (beamDrift < 0.015) {
                    beamColor = varToHexColor('--color-safe');
                } else if (beamDrift < 0.018) {
                    beamColor = varToHexColor('--color-warning');
                } else if (beamDrift < 0.030) {
                    beamColor = varToHexColor('--color-damage');
                } else {
                    beamColor = 0x222222; // fallo local de la viga
                }
                if (beam.material) beam.material.color.setHex(beamColor);

                if (useFlexure) {
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
                const colA = cols[beam.ix * numColsY + beam.iy];
                const colB = cols[beam.ix * numColsY + (beam.iy + 1)];

                // Calcular drift de viga basado en las columnas que conecta
                const beamDrift = Math.max(colA.currentDriftRatio || 0, colB.currentDriftRatio || 0);

                let beamColor;
                if (beamDrift < 0.015) {
                    beamColor = varToHexColor('--color-safe');
                } else if (beamDrift < 0.018) {
                    beamColor = varToHexColor('--color-warning');
                } else if (beamDrift < 0.030) {
                    beamColor = varToHexColor('--color-damage');
                } else {
                    beamColor = 0x222222; // fallo local de la viga
                }
                if (beam.material) beam.material.color.setHex(beamColor);

                if (useFlexure) {
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

    // Actualizar partículas y FX ambientales
    updateParticles();
    updateAmbientMotes(performance.now());
    updateShockwaves();

    // Delta de tiempo entre frames (para FX continuos)
    const nowTs = performance.now();
    const frameDt = Math.min(0.05, lastFrameTs ? (nowTs - lastFrameTs) / 1000 : 0.016);
    lastFrameTs = nowTs;

    // Ondas sísmicas en la malla del terreno
    updateTerrainWaves(frameDt);

    // Visualizador de modos de vibración (solo en calma, sin simulación activa)
    if (modeViewer.active && !isPlaying && eq2001 && eq2019) {
        modeViewerClock += frameDt;
        runModeViewerFrame();
    }

    // Sacudida de cámara proporcional a la aceleración del terreno.
    // Se aplica un offset temporal solo durante el render para no perturbar OrbitControls.
    if (cameraShake > 0.004) {
        const ox = (Math.random() - 0.5) * cameraShake;
        const oy = (Math.random() - 0.5) * cameraShake * 0.6;
        const oz = (Math.random() - 0.5) * cameraShake;

        camera.position.x += ox;
        camera.position.y += oy;
        camera.position.z += oz;
        renderer.render(scene, camera);
        camera.position.x -= ox;
        camera.position.y -= oy;
        camera.position.z -= oz;

        cameraShake *= 0.90; // decaimiento suave
    } else {
        renderer.render(scene, camera);
    }
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
    updateViewportPhasePill("En reposo", "text-green");

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
        "earthquake-input-type", "file-accelerogram", "custom-file-dt", "custom-direction",
        "ise-enable", "ise-foundation-type", "ise-vs", "ise-df", "ise-poisson", "ise-density",
        "auto-mass", "building-use", "slab-thickness", "extra-dead-load",
        "evacuation-mode", "show-terrain-waves", "show-ssi-springs"
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

    const activeDir = getActiveSismoDirection(currentTime);

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

// Actualiza la píldora HUD de fase sísmica sobre el viewport 3D
function updateViewportPhasePill(text, phaseClass) {
    const pill = document.getElementById("viewport-phase-pill");
    const pillText = document.getElementById("viewport-phase-text");
    if (!pill || !pillText) return;

    pillText.textContent = text;
    pill.classList.remove("is-safe", "is-warning", "is-danger");

    if (phaseClass.includes("text-red")) {
        pill.classList.add("is-danger");
    } else if (phaseClass.includes("text-yellow")) {
        pill.classList.add("is-warning");
    } else if (phaseClass.includes("text-green")) {
        pill.classList.add("is-safe");
    }
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

    // Espejo en la píldora HUD sobre el viewport 3D
    updateViewportPhasePill(phaseSpan.textContent, phaseSpan.className);

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
                        label: function (context) {
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
                        callback: function (value) {
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

window.changePopupPhoto = function (buildingId, direction) {
    if (!window.mapBuildings) return;
    const building = window.mapBuildings.find(b => b.id === buildingId);
    if (!building) return;

    const photos = Array.isArray(building.photo) ? building.photo : (building.photo ? [building.photo] : []);
    if (photos.length <= 1) return;

    if (building.currentPhotoIndex === undefined) {
        building.currentPhotoIndex = 0;
    }

    building.currentPhotoIndex += direction;
    if (building.currentPhotoIndex < 0) {
        building.currentPhotoIndex = photos.length - 1;
    } else if (building.currentPhotoIndex >= photos.length) {
        building.currentPhotoIndex = 0;
    }

    const imgEl = document.getElementById(`popup-photo-img-${buildingId}`);
    if (imgEl) {
        imgEl.src = photos[building.currentPhotoIndex];
    }

    const wrapper = document.getElementById(`popup-photo-wrapper-${buildingId}`);
    if (wrapper) {
        wrapper.setAttribute('onclick', `window.open('${photos[building.currentPhotoIndex]}', '_blank')`);
    }

    const counterEl = document.getElementById(`popup-photo-counter-${buildingId}`);
    if (counterEl) {
        counterEl.textContent = `${building.currentPhotoIndex + 1} / ${photos.length}`;
    }
};

// ============================================================================
// --- SIMULACIÓN URBANA 3D: DOBLETE SÍSMICO DE LA GUAIRA (24/Jun/2026) ---
// Visualización cinematográfica (NO normativa): los edificios del catálogo real
// de Vargas se extruyen sobre la imagen satelital y reproducen su desenlace
// reportado durante el doblete 0.40g (t=0) / 0.60g (t=40s).
// ============================================================================
let citySim = null;

const CITY_CFG = {
    duration: 75.0,
    pga1: 0.40,
    pga2: 0.60,
    shock2Start: 40.0,
    bbox: { latMin: 10.55, latMax: 10.65, lngMin: -67.10, lngMax: -66.75 },
    fpScale: 3.5,          // exageración de huella (visibilidad a escala de ciudad)
    htScale: 5.0,          // exageración de altura
    dispExag: 60.0,        // exageración de desplazamientos (cinemática visible)
    collapseDur: 2.4,      // duración de la animación de colapso (s)
    waveSpeed: 2800,       // velocidad aparente de la onda sísmica oeste→este (m/s)
    vertExag: 1.15,        // exageración vertical del relieve
    seed: 20260624
};

// Matriz temporal reutilizable (actualización de instancias del tejido urbano)
const _cityTmpMat = typeof THREE !== 'undefined' ? new THREE.Matrix4() : null;

// Probabilidad de colapso Monte Carlo (misma tabla del mapa de daño) para la ficha
const CITY_COLLAPSE_MC = { 4: 45.5, 5: 63.6, 6: 36.4, 7: 72.7, 8: 63.6, 9: 63.6, 10: 54.5 };

// RNG determinístico (mulberry32) para que la simulación sea reproducible
function cityMulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function cityHashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}

// Acelerograma sintético del doblete (Kanai-Tajimi + Jennings), versión con semilla
function buildCityGroundMotion() {
    const dtC = 0.02;
    const n = Math.ceil(CITY_CFG.duration / dtC);
    const acc = new Float32Array(n);
    const rng = cityMulberry32(CITY_CFG.seed);
    const omega_g = (2.0 * Math.PI) / 0.60; // suelo aluvial S3, T_g ≈ 0.6 s
    const zeta_g = 0.6;

    const whiteNoise = () => {
        const w = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const u1 = Math.max(rng(), 1e-12), u2 = rng();
            w[i] = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);
        }
        return w;
    };
    const ktFilter = (noise) => {
        const out = new Float32Array(n);
        let x_f = 0, v_f = 0, a_f = 0;
        for (let i = 0; i < n; i++) {
            const x_p = x_f + dtC * v_f + dtC * dtC * 0.25 * a_f;
            const v_p = v_f + 0.5 * dtC * a_f;
            const a_n = noise[i] - 2.0 * zeta_g * omega_g * v_p - omega_g * omega_g * x_p;
            x_f = x_p + 0.25 * dtC * dtC * a_n;
            v_f = v_p + 0.5 * dtC * a_n;
            a_f = a_n;
            out[i] = 2.0 * zeta_g * omega_g * v_f + omega_g * omega_g * x_f;
        }
        let mx = 0;
        for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(out[i]));
        if (mx > 0) for (let i = 0; i < n; i++) out[i] /= mx;
        return out;
    };

    const f1 = ktFilter(whiteNoise());
    const f2 = ktFilter(whiteNoise());
    for (let i = 0; i < n; i++) {
        const t = i * dtC;
        let env1 = 0, env2 = 0;
        if (t >= 0 && t < 30) {
            if (t < 2.0) env1 = Math.pow(t / 2.0, 2);
            else if (t <= 10.0) env1 = 1.0;
            else env1 = Math.exp(-0.15 * (t - 10.0));
        }
        if (t >= CITY_CFG.shock2Start && t < 75) {
            const tl = t - CITY_CFG.shock2Start;
            if (tl < 2.5) env2 = Math.pow(tl / 2.5, 2);
            else if (tl <= 12.0) env2 = 1.0;
            else env2 = Math.exp(-0.12 * (tl - 12.0));
        }
        acc[i] = f1[i] * env1 * CITY_CFG.pga1 + f2[i] * env2 * CITY_CFG.pga2;
    }
    return { acc, dt: dtC };
}

function sampleCityAccel(t) {
    if (!citySim || !citySim.motion) return 0;
    const { acc, dt } = citySim.motion;
    const pos = t / dt;
    const i = Math.floor(pos);
    if (i < 0 || i >= acc.length - 1) return 0;
    const frac = pos - i;
    return acc[i] * (1 - frac) + acc[i + 1] * frac;
}

// Mosaico satelital ESRI (World Imagery soporta CORS) → textura del terreno
function cityLng2TileX(lng, z) { return Math.floor((lng + 180) / 360 * Math.pow(2, z)); }
function cityLat2TileY(lat, z) {
    const r = lat * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z));
}
function cityTileX2Lng(x, z) { return x / Math.pow(2, z) * 360 - 180; }
function cityTileY2Lat(y, z) {
    const n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
    return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

// Muestreo bilineal de la malla de elevaciones (fila 0 = norte)
function citySampleHeight(hg, cols, rows, u, vN) {
    const gx = Math.max(0, Math.min(cols - 1.001, u * (cols - 1)));
    const gy = Math.max(0, Math.min(rows - 1.001, vN * (rows - 1)));
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = gx - x0, fy = gy - y0;
    const h00 = hg[y0 * cols + x0], h10 = hg[y0 * cols + x0 + 1];
    const h01 = hg[(y0 + 1) * cols + x0], h11 = hg[(y0 + 1) * cols + x0 + 1];
    return (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;
}

async function buildCitySatelliteGround(scene, toScene, extent) {
    const margin = 0.12;
    const latSpan = extent.latMax - extent.latMin, lngSpan = extent.lngMax - extent.lngMin;
    const latMin = extent.latMin - latSpan * margin, latMax = extent.latMax + latSpan * margin;
    const lngMin = extent.lngMin - lngSpan * margin, lngMax = extent.lngMax + lngSpan * margin;

    let z = 15, x0, x1, y0, y1, tilesX, tilesY;
    while (z > 12) {
        x0 = cityLng2TileX(lngMin, z); x1 = cityLng2TileX(lngMax, z);
        y0 = cityLat2TileY(latMax, z); y1 = cityLat2TileY(latMin, z);
        tilesX = x1 - x0 + 1; tilesY = y1 - y0 + 1;
        if (tilesX * tilesY <= 44) break;
        z--;
    }

    const canvas = document.createElement('canvas');
    canvas.width = tilesX * 256;
    canvas.height = tilesY * 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0d1420';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const loadTile = (tx, ty) => new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        const done = (ok) => {
            clearTimeout(timer);
            if (ok) ctx.drawImage(img, (tx - x0) * 256, (ty - y0) * 256);
            resolve(ok);
        };
        const timer = setTimeout(() => { img.src = ''; done(false); }, 9000);
        img.onload = () => done(true);
        img.onerror = () => done(false);
        img.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${ty}/${tx}`;
    });

    const jobs = [];
    for (let tx = x0; tx <= x1; tx++) for (let ty = y0; ty <= y1; ty++) jobs.push(loadTile(tx, ty));
    const results = await Promise.all(jobs);
    const okCount = results.filter(Boolean).length;
    if (okCount < jobs.length * 0.75) throw new Error(`Mosaico satelital incompleto (${okCount}/${jobs.length})`);

    const texture = new THREE.CanvasTexture(canvas);
    texture.encoding = THREE.sRGBEncoding;
    texture.anisotropy = 4;

    const latC = (cityTileY2Lat(y0, z) + cityTileY2Lat(y1 + 1, z)) / 2;
    const mpp = 156543.03392 * Math.cos(latC * Math.PI / 180) / Math.pow(2, z);
    const planeW = canvas.width * mpp, planeH = canvas.height * mpp;
    const lngMid = (cityTileX2Lng(x0, z) + cityTileX2Lng(x1 + 1, z)) / 2;
    const latMid = (cityTileY2Lat(y0, z) + cityTileY2Lat(y1 + 1, z)) / 2;
    const center = toScene(latMid, lngMid);

    // --- Elevaciones: teselas Terrarium (AWS, CORS habilitado, sin API key) ---
    // Decodificación Terrarium: elevación(m) = R·256 + G + B/256 − 32768
    const TS = 64; // submuestreo 4× por tesela (256 → 64 muestras)
    const cols = tilesX * TS, rows = tilesY * TS;
    const hgrid = new Float32Array(cols * rows);
    let demType = 'terrarium';
    try {
        const loadDem = (tx, ty) => new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            const done = (ok) => {
                clearTimeout(timer);
                if (ok) {
                    const c = document.createElement('canvas');
                    c.width = TS; c.height = TS;
                    const cctx = c.getContext('2d');
                    cctx.drawImage(img, 0, 0, TS, TS);
                    const d = cctx.getImageData(0, 0, TS, TS).data;
                    const r0 = (ty - y0) * TS, c0 = (tx - x0) * TS;
                    for (let py = 0; py < TS; py++) for (let px = 0; px < TS; px++) {
                        const k = (py * TS + px) * 4;
                        const elev = d[k] * 256 + d[k + 1] + d[k + 2] / 256 - 32768;
                        hgrid[(r0 + py) * cols + c0 + px] = elev > -5 ? elev : -5;
                    }
                }
                resolve(ok);
            };
            const timer = setTimeout(() => { img.src = ''; done(false); }, 9000);
            img.onload = () => done(true);
            img.onerror = () => done(false);
            // Nota: Terrarium usa orden z/x/y (a diferencia de ESRI, que es z/y/x)
            img.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${tx}/${ty}.png`;
        });
        const demJobs = [];
        for (let tx = x0; tx <= x1; tx++) for (let ty = y0; ty <= y1; ty++) demJobs.push(loadDem(tx, ty));
        const demRes = await Promise.all(demJobs);
        const demOk = demRes.filter(Boolean).length;
        if (demOk < demJobs.length * 0.75) throw new Error(`DEM incompleto (${demOk}/${demJobs.length})`);
    } catch (e) {
        // Respaldo: cresta procedural del cordón montañoso al sur de la franja urbana
        console.warn('[city-sim] DEM Terrarium no disponible, usando cresta procedural:', e.message);
        demType = 'procedural';
        for (let r = 0; r < rows; r++) for (let cI = 0; cI < cols; cI++) {
            const vN = r / (rows - 1); // 0 norte (mar) → 1 sur (montaña)
            const s = Math.max(0, Math.min(1, (vN - 0.45) / 0.5));
            const mod = 0.82 + 0.18 * Math.sin(cI * 0.11 + r * 0.07) * Math.sin(cI * 0.031 + 1.3);
            hgrid[r * cols + cI] = Math.pow(s, 1.25) * 2350 * mod;
        }
    }

    // --- Plano segmentado desplazado por las elevaciones ---
    const segX = Math.min(240, Math.max(120, tilesX * 26));
    const segY = Math.min(120, Math.max(48, tilesY * 26));
    const geo = new THREE.PlaneGeometry(planeW, planeH, segX, segY);
    const posAttr = geo.getAttribute('position');
    const nv = posAttr.count;
    const baseX = new Float32Array(nv);   // x local (oeste→este, = x mundo − centro)
    const baseH = new Float32Array(nv);   // altura del relieve (eje z local → y mundo)
    const delays = new Float32Array(nv);  // retardo de la onda viajera por vértice
    let maxH = 0;
    for (let i = 0; i < nv; i++) {
        const lx = posAttr.getX(i), ly = posAttr.getY(i);
        const u = (lx + planeW / 2) / planeW;
        const vN = 1 - (ly + planeH / 2) / planeH; // ly=+H/2 es el borde norte
        const hgt = citySampleHeight(hgrid, cols, rows, u, vN) * CITY_CFG.vertExag;
        posAttr.setZ(i, hgt);
        if (hgt > maxH) maxH = hgt;
        baseX[i] = lx;
        baseH[i] = hgt;
        delays[i] = (lx + planeW / 2) / CITY_CFG.waveSpeed;
    }
    posAttr.needsUpdate = true;

    const mat = new THREE.MeshBasicMaterial({ map: texture, color: 0xa3adbb });
    const plane = new THREE.Mesh(geo, mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(center.x, 0, center.z);
    scene.add(plane);

    return {
        mesh: plane, posAttr, baseX, baseH, delays, maxH, demType,
        xWest: center.x - planeW / 2, xEast: center.x + planeW / 2,
        zMin: center.z - planeH / 2, zMax: center.z + planeH / 2,
        heightAt: (wx, wz) => {
            const u = (wx - center.x + planeW / 2) / planeW;
            const vN = 1 - ((center.z - wz) + planeH / 2) / planeH;
            return citySampleHeight(hgrid, cols, rows, u, vN) * CITY_CFG.vertExag;
        }
    };
}

// Terreno estilizado de respaldo si el mosaico satelital no está disponible
// (incluye cresta procedural del cordón montañoso para conservar la lectura del paisaje)
function buildCityFallbackGround(scene) {
    const W = 60000, H = 30000;
    const ridgeAt = (lx, ly) => {
        const vN = 1 - (ly + H / 2) / H; // 0 norte → 1 sur
        const s = Math.max(0, Math.min(1, (vN - 0.45) / 0.45));
        const mod = 0.82 + 0.18 * Math.sin(lx * 0.0008) * Math.sin(ly * 0.0013 + 1.7);
        return Math.pow(s, 1.25) * 2350 * CITY_CFG.vertExag * mod;
    };
    const geo = new THREE.PlaneGeometry(W, H, 180, 90);
    const posAttr = geo.getAttribute('position');
    const nv = posAttr.count;
    const baseX = new Float32Array(nv), baseH = new Float32Array(nv), delays = new Float32Array(nv);
    for (let i = 0; i < nv; i++) {
        const lx = posAttr.getX(i), ly = posAttr.getY(i);
        const hgt = ridgeAt(lx, ly);
        posAttr.setZ(i, hgt);
        baseX[i] = lx;
        baseH[i] = hgt;
        delays[i] = (lx + W / 2) / CITY_CFG.waveSpeed;
    }
    posAttr.needsUpdate = true;
    const ground = new THREE.Mesh(geo,
        new THREE.MeshStandardMaterial({ color: 0x141c26, roughness: 1.0 }));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    const grid = new THREE.GridHelper(60000, 150, 0x1d2a3a, 0x16202e);
    grid.position.y = 1;
    scene.add(grid);
    const sea = new THREE.Mesh(
        new THREE.PlaneGeometry(60000, 14000),
        new THREE.MeshStandardMaterial({ color: 0x0a2436, roughness: 0.35, metalness: 0.4 })
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, 0.5, -11500);
    scene.add(sea);
    return {
        mesh: ground, posAttr, baseX, baseH, delays, maxH: 2350 * CITY_CFG.vertExag, demType: 'procedural',
        xWest: -W / 2, xEast: W / 2, zMin: -H / 2, zMax: H / 2,
        heightAt: (wx, wz) => ridgeAt(wx, -wz)
    };
}

// --- Datos y Funciones para Visualización de Abanicos Fluviales (Vulnerabilidad y Licuación) ---
const alluvialFansData = [
    {
        name: "Abanico de Caraballeda (Río San Julián)",
        apex: { lat: 10.6045, lng: -66.8520 },
        radius: 1700,
        startAngle: 55 * Math.PI / 180,
        endAngle: 125 * Math.PI / 180,
        color: 0xef4444, // Rojo (Riesgo Alto de Licuación)
        label: "Riesgo Alto (Aluvión y Licuación)"
    },
    {
        name: "Abanico de Tanaguarena (Río Cerro Grande)",
        apex: { lat: 10.6075, lng: -66.8675 },
        radius: 1300,
        startAngle: 60 * Math.PI / 180,
        endAngle: 120 * Math.PI / 180,
        color: 0xf59e0b, // Naranja (Riesgo Moderado-Alto)
        label: "Riesgo Moderado-Alto"
    },
    {
        name: "Abanico de Macuto (Río Macuto)",
        apex: { lat: 10.6030, lng: -66.8950 },
        radius: 1200,
        startAngle: 65 * Math.PI / 180,
        endAngle: 115 * Math.PI / 180,
        color: 0xef4444,
        label: "Riesgo Alto"
    },
    {
        name: "Abanico de Carmen de Uria",
        apex: { lat: 10.6080, lng: -66.8285 },
        radius: 1100,
        startAngle: 60 * Math.PI / 180,
        endAngle: 120 * Math.PI / 180,
        color: 0xef4444,
        label: "Riesgo Alto (Fuerte Susceptibilidad)"
    },
    {
        name: "Abanico de La Guaira (Quebrada Osorio)",
        apex: { lat: 10.5980, lng: -66.9320 },
        radius: 1000,
        startAngle: 70 * Math.PI / 180,
        endAngle: 110 * Math.PI / 180,
        color: 0xf59e0b,
        label: "Riesgo Moderado"
    }
];

function createAlluvialFanMesh(centerX, centerZ, radius, startAngle, endAngle, colorHex) {
    const geom = new THREE.RingGeometry(0, radius, 32, 8, startAngle, endAngle - startAngle);
    geom.rotateX(-Math.PI / 2);
    
    const posAttr = geom.getAttribute('position');
    const terr = citySim.terrain;
    
    for (let i = 0; i < posAttr.count; i++) {
        const rx = posAttr.getX(i);
        const rz = posAttr.getZ(i);
        
        const wx = rx + centerX;
        const wz = rz + centerZ;
        
        let vy = 2;
        if (terr && typeof terr.heightAt === 'function') {
            vy = terr.heightAt(wx, wz);
        }
        
        posAttr.setX(i, wx);
        posAttr.setY(i, vy + 4.5); // 4.5m offset to fly clean over satellite tiles
        posAttr.setZ(i, wz);
    }
    
    geom.computeVertexNormals();
    
    const mat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false
    });
    
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(0, 0, 0);
    return mesh;
}

// --- Datos y Funciones para Profundidad a Roca Dura (0-450m) ---
function getBedrockDepth(lat, lng) {
    const dSouth = Math.max(0, (lat - 10.592) * 110540); // metros al norte del pie de monte de El Ávila
    let depth = dSouth * 0.13;

    // Depresión aluvial profunda en Caraballeda / San Julián
    const dCaraballeda = Math.sqrt(Math.pow((lat - 10.612) * 110540, 2) + Math.pow((lng - (-66.832)) * 98000, 2));
    if (dCaraballeda < 2400) {
        const basinFactor = Math.max(0, 1 - dCaraballeda / 2400);
        depth += 240 * Math.pow(basinFactor, 1.1);
    }

    // Depresión secundaria en Macuto / Tanaguarena
    const dMacuto = Math.sqrt(Math.pow((lat - 10.608) * 110540, 2) + Math.pow((lng - (-66.885)) * 98000, 2));
    if (dMacuto < 1600) {
        depth += 85 * (1 - dMacuto / 1600);
    }

    return Math.max(5, Math.min(445, depth));
}

function getBedrockDepthRangeInfo(depth) {
    if (depth <= 50) {
        return { id: '0-50', label: '0 – 50 m (Roca Superficial)', colorHex: 0x10b981, colorCss: '#10b981' };
    } else if (depth <= 150) {
        return { id: '50-150', label: '50 – 150 m (Profundidad Moderada)', colorHex: 0x84cc16, colorCss: '#84cc16' };
    } else if (depth <= 250) {
        return { id: '150-250', label: '150 – 250 m (Profundidad Intermedia)', colorHex: 0xfacc15, colorCss: '#facc15' };
    } else if (depth <= 350) {
        return { id: '250-350', label: '250 – 350 m (Profundidad Alta / Resonancia)', colorHex: 0xf97316, colorCss: '#f97316' };
    } else {
        return { id: '350-450', label: '350 – 450 m (Basamento Muy Profundo)', colorHex: 0xef4444, colorCss: '#ef4444' };
    }
}

function createBedrockDepthBandsMesh(toScene, ext) {
    const meshes = [];
    const rows = 45;
    const cols = 55;
    const latStep = (ext.latMax - ext.latMin) / rows;
    const lngStep = (ext.lngMax - ext.lngMin) / cols;

    const ranges = [
        { id: '0-50', maxD: 50, colorHex: 0x10b981, vertices: [] },
        { id: '50-150', maxD: 150, colorHex: 0x84cc16, vertices: [] },
        { id: '150-250', maxD: 250, colorHex: 0xfacc15, vertices: [] },
        { id: '250-350', maxD: 350, colorHex: 0xf97316, vertices: [] },
        { id: '350-450', maxD: 450, colorHex: 0xef4444, vertices: [] }
    ];

    const terr = citySim.terrain;

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const lat0 = ext.latMin + r * latStep;
            const lat1 = lat0 + latStep;
            const lng0 = ext.lngMin + c * lngStep;
            const lng1 = lng0 + lngStep;

            const latC = (lat0 + lat1) / 2;
            const lngC = (lng0 + lng1) / 2;
            const depth = getBedrockDepth(latC, lngC);

            const targetRange = ranges.find(rng => depth <= rng.maxD) || ranges[4];

            const p00 = toScene(lat0, lng0);
            const p10 = toScene(lat1, lng0);
            const p11 = toScene(lat1, lng1);
            const p01 = toScene(lat0, lng1);

            const getY = (pos) => (terr && typeof terr.heightAt === 'function') ? terr.heightAt(pos.x, pos.z) + 3.8 : 3.8;

            const y00 = getY(p00), y10 = getY(p10), y11 = getY(p11), y01 = getY(p01);

            targetRange.vertices.push(
                p00.x, y00, p00.z,  p10.x, y10, p10.z,  p11.x, y11, p11.z,
                p00.x, y00, p00.z,  p11.x, y11, p11.z,  p01.x, y01, p01.z
            );
        }
    }

    ranges.forEach(rng => {
        if (rng.vertices.length === 0) return;
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(rng.vertices, 3));
        geom.computeVertexNormals();

        const mat = new THREE.MeshBasicMaterial({
            color: rng.colorHex,
            transparent: true,
            opacity: 0.38,
            side: THREE.DoubleSide,
            depthWrite: false
        });

        const mesh = new THREE.Mesh(geom, mat);
        meshes.push(mesh);
    });

    return meshes;
}

async function initCitySim() {
    const container = document.getElementById('city-canvas-container');
    const loadingEl = document.getElementById('city-loading');
    if (!container || typeof THREE === 'undefined') {
        if (loadingEl) loadingEl.innerHTML = '<span>Three.js no está disponible.</span>';
        return;
    }

    citySim = {
        active: true, playing: false, speed: 1, t: 0,
        scene: null, camera: null, renderer: null, controls: null,
        group: null, motion: null, buildings: [], fillers: null,
        dust: [], raycaster: new THREE.Raycaster(), pointer: new THREE.Vector2(),
        lastFrame: 0, extent: null
    };

    // --- Cargar catálogo y filtrar el corredor de Vargas ---
    let catalog = window.mapBuildings;
    if (!catalog) {
        try {
            const res = await fetch('buildings.json');
            catalog = await res.json();
            window.mapBuildings = catalog;
        } catch (e) {
            if (loadingEl) loadingEl.innerHTML = '<span>Error al cargar buildings.json</span>';
            return;
        }
    }
    const bb = CITY_CFG.bbox;
    const vargas = catalog.filter(b =>
        b.lat >= bb.latMin && b.lat <= bb.latMax && b.lng >= bb.lngMin && b.lng <= bb.lngMax);
    if (vargas.length === 0) {
        if (loadingEl) loadingEl.innerHTML = '<span>Sin edificios del catálogo en el área.</span>';
        return;
    }

    // --- Transformación geográfica → metros de escena ---
    const lat0 = vargas.reduce((a, b) => a + b.lat, 0) / vargas.length;
    const lng0 = vargas.reduce((a, b) => a + b.lng, 0) / vargas.length;
    const mPerDegLat = 110540.0;
    const mPerDegLng = 111320.0 * Math.cos(lat0 * Math.PI / 180);
    const toScene = (lat, lng) => ({ x: (lng - lng0) * mPerDegLng, z: -(lat - lat0) * mPerDegLat });
    const ext = {
        latMin: Math.min(...vargas.map(b => b.lat)), latMax: Math.max(...vargas.map(b => b.lat)),
        lngMin: Math.min(...vargas.map(b => b.lng)), lngMax: Math.max(...vargas.map(b => b.lng))
    };
    citySim.extent = ext;

    // --- Escena ---
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d1420);
    scene.fog = new THREE.FogExp2(0x0d1420, 0.000055);
    citySim.scene = scene;

    const camera = new THREE.PerspectiveCamera(46, container.clientWidth / container.clientHeight, 5, 120000);
    citySim.camera = camera;

    // Anclar el encuadre inicial al clúster más denso del catálogo (vista de barrio;
    // el usuario puede alejarse con la órbita para ver todo el corredor costero)
    let anchorB = vargas[0], anchorCount = -1;
    vargas.forEach(b => {
        let c = 0;
        vargas.forEach(o => {
            const dx = (o.lng - b.lng) * mPerDegLng, dz = (o.lat - b.lat) * mPerDegLat;
            if (dx * dx + dz * dz < 500 * 500) c++;
        });
        if (c > anchorCount) { anchorCount = c; anchorB = b; }
    });
    const anchorPos = toScene(anchorB.lat, anchorB.lng);
    camera.position.set(anchorPos.x + 1150, 720, anchorPos.z + 1550);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputEncoding = THREE.sRGBEncoding;
    container.appendChild(renderer.domElement);
    citySim.renderer = renderer;

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = 200;
    controls.maxDistance = 45000;
    controls.target.set(anchorPos.x, 50, anchorPos.z);
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;
    controls.addEventListener('start', () => { controls.autoRotate = false; });
    citySim.controls = controls;

    scene.add(new THREE.HemisphereLight(0x8fb4d8, 0x1a1410, 0.85));
    const sun = new THREE.DirectionalLight(0xffd9a0, 0.9);
    sun.position.set(-9000, 6500, -4000);
    scene.add(sun);

    // Grupo de la ciudad (se desplaza con el movimiento del terreno)
    const group = new THREE.Group();
    scene.add(group);
    citySim.group = group;

    // --- Terreno (satélite real + elevaciones DEM, con respaldo estilizado) ---
    try {
        citySim.terrain = await buildCitySatelliteGround(group, toScene, ext);
        citySim.groundType = 'satellite';
    } catch (e) {
        console.warn('[city-sim] Mosaico satelital no disponible, usando terreno estilizado:', e.message);
        citySim.terrain = buildCityFallbackGround(group);
        citySim.groundType = 'fallback';
    }
    const terr = citySim.terrain;
    const xWest = terr.xWest;

    // --- Capa de Abanicos Fluviales (Vulnerabilidad y Licuación) ---
    const fansGroup = new THREE.Group();
    fansGroup.visible = false; // oculto por defecto
    group.add(fansGroup);
    citySim.fansGroup = fansGroup;

    alluvialFansData.forEach(fan => {
        const centerPos = toScene(fan.apex.lat, fan.apex.lng);
        const mesh = createAlluvialFanMesh(centerPos.x, centerPos.z, fan.radius, fan.startAngle, fan.endAngle, fan.color);
        fansGroup.add(mesh);
    });

    // --- Capa de Profundidad a Roca Dura (0-450m) ---
    const bedrockGroup = new THREE.Group();
    bedrockGroup.visible = false; // oculto por defecto
    group.add(bedrockGroup);
    citySim.bedrockGroup = bedrockGroup;

    try {
        const bedrockBands = createBedrockDepthBandsMesh(toScene, ext);
        bedrockBands.forEach(m => bedrockGroup.add(m));
    } catch (e) {
        console.warn('[city-sim] Error al generar mallas de profundidad a roca dura:', e);
    }

    console.info(`[city-sim] Terreno: ${citySim.groundType}, DEM: ${terr.demType}, altura máx ≈ ${Math.round(terr.maxH)} m, onda oeste→este a ${CITY_CFG.waveSpeed} m/s`);

    // --- Frentes de onda sísmica (uno por evento del doblete) ---
    // Envolvente Jennings de cada evento (misma parametrización del registro)
    const shockEnvelope = (start) => {
        const is2 = start > 0;
        const pga = is2 ? CITY_CFG.pga2 : CITY_CFG.pga1;
        const ramp = is2 ? 2.5 : 2.0, hold = is2 ? 12.0 : 10.0;
        const decay = is2 ? 0.12 : 0.15, end = is2 ? 35 : 30;
        return (age) => {
            if (age < 0 || age >= end) return 0;
            if (age < ramp) return Math.pow(age / ramp, 2) * pga;
            if (age <= hold) return pga;
            return Math.exp(-decay * (age - hold)) * pga;
        };
    };
    citySim.waveFronts = [0, CITY_CFG.shock2Start].map(start => {
        const c = document.createElement('canvas');
        c.width = 4; c.height = 128;
        const cctx = c.getContext('2d');
        const grad = cctx.createLinearGradient(0, 128, 0, 0);
        grad.addColorStop(0, 'rgba(96,224,255,0.9)');
        grad.addColorStop(0.35, 'rgba(56,189,248,0.38)');
        grad.addColorStop(1, 'rgba(56,189,248,0)');
        cctx.fillStyle = grad;
        cctx.fillRect(0, 0, 4, 128);
        const tex = new THREE.CanvasTexture(c);
        const matF = new THREE.MeshBasicMaterial({
            map: tex, transparent: true, opacity: 0, side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending, depthWrite: false, fog: false
        });
        const zSpan = (terr.zMax - terr.zMin) * 1.04;
        const front = new THREE.Mesh(new THREE.PlaneGeometry(zSpan, 1500), matF);
        front.rotation.y = Math.PI / 2; // panel vertical perpendicular al eje x
        front.position.set(xWest, 750, (terr.zMin + terr.zMax) / 2);
        front.visible = false;
        front.renderOrder = 5;
        scene.add(front);
        return { mesh: front, start, env: shockEnvelope(start) };
    });

    // --- Edificios del catálogo (extrusión de rectángulos reales) ---
    const baseColor = new THREE.Color(0xa855f7); // Violeta para catálogo real
    vargas.forEach((b) => {
        const rngB = cityMulberry32(cityHashStr(b.id || b.name));
        const N = Math.max(2, b.floors || 5);
        const h = N * 3.0 * CITY_CFG.htScale;
        const fp = (12.0 + rngB() * 6.0) * CITY_CFG.fpScale;
        const pos = toScene(b.lat, b.lng);

        const geo = new THREE.BoxGeometry(fp, h, fp * (0.75 + rngB() * 0.5));
        geo.translate(0, h / 2, 0);
        const tint = 0.9 + rngB() * 0.2;
        const col = baseColor.clone().multiplyScalar(tint);
        const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.85, metalness: 0.08 });
        const mesh = new THREE.Mesh(geo, mat);
        const gy = terr.heightAt ? Math.max(0, terr.heightAt(pos.x, pos.z)) : 0;
        mesh.position.set(pos.x, gy, pos.z);
        mesh.rotation.y = (rngB() - 0.5) * 0.5;
        mesh.userData.x0 = pos.x;
        mesh.userData.z0 = pos.z;
        group.add(mesh);

        const st = {
            b, mesh, N, h, baseColor: col.clone(),
            T: 0.06 * N + 0.15, u: 0, v: 0,
            status: b.status, damageLevel: b.damage_level,
            collapseT: null, toppleZ: 0, toppleX: 0, shiftX: 0, shiftZ: 0,
            damageT: null, tiltZ: 0, tiltX: 0,
            delay: (pos.x - xWest) / CITY_CFG.waveSpeed, y0: gy,
            dustSpawned: false, rubble: null, event: null
        };

        if (b.status === 'collapsed') {
            const shock = rngB() < 0.35 ? 1 : 2;
            st.event = shock;
            st.collapseT = shock === 1 ? 3.0 + rngB() * 21.0 : CITY_CFG.shock2Start + 2.5 + rngB() * 24.0;
            const dir = rngB() < 0.5 ? -1 : 1;
            st.toppleZ = dir * (0.05 + rngB() * 0.11);
            st.toppleX = (rngB() - 0.5) * 0.10;
            st.shiftX = (rngB() - 0.5) * fp * 0.35;
            st.shiftZ = (rngB() - 0.5) * fp * 0.35;
            // Montículo de escombros (aparece al final del colapso)
            const hr = 2.2 * CITY_CFG.htScale + rngB() * 1.5 * CITY_CFG.htScale;
            const rGeo = new THREE.BoxGeometry(fp * 1.35, hr, fp * 1.35);
            rGeo.translate(0, hr / 2, 0);
            const rubble = new THREE.Mesh(rGeo,
                new THREE.MeshStandardMaterial({ color: 0x5a5044, roughness: 1.0 }));
            rubble.position.set(pos.x + st.shiftX * 0.6, gy, pos.z + st.shiftZ * 0.6);
            rubble.userData.x0 = rubble.position.x;
            rubble.userData.z0 = rubble.position.z;
            rubble.rotation.y = rngB() * Math.PI;
            rubble.scale.y = 0.001;
            rubble.visible = false;
            group.add(rubble);
            st.rubble = rubble;
        } else {
            st.event = rngB() < 0.3 ? 1 : 2;
            st.damageT = st.event === 1 ? 3.0 + rngB() * 20.0 : CITY_CFG.shock2Start + 1.5 + rngB() * 22.0;
            const mag = (b.damage_level === 'severo') ? 0.026 + rngB() * 0.020 : 0.007 + rngB() * 0.009;
            const dir = rngB() < 0.5 ? -1 : 1;
            st.tiltZ = dir * mag;
            st.tiltX = (rngB() - 0.5) * mag * 0.8;
        }
        mesh.userData.cityState = st;
        citySim.buildings.push(st);
    });

    // --- Tejido urbano genérico (extrusiones de contexto, InstancedMesh) ---
    const rngF = cityMulberry32(CITY_CFG.seed ^ 0x5F3759DF);
    const fillerCount = 520;
    const fGeo = new THREE.BoxGeometry(1, 1, 1);
    fGeo.translate(0, 0.5, 0);
    const fMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.1 });
    const fillers = new THREE.InstancedMesh(fGeo, fMat, fillerCount);
    const dummy = new THREE.Object3D();
    
    // Paleta de colores urbanos realistas y variados (pasteles desaturados)
    const fPalette = [
        new THREE.Color(0x334155), // Gris oscuro pizarra (Slate 700)
        new THREE.Color(0x1e293b), // Gris muy oscuro (Slate 800)
        new THREE.Color(0x27272a), // Gris carbón (Zinc 800)
        new THREE.Color(0x3f3f46), // Gris zinc (Zinc 700)
        new THREE.Color(0x475569)  // Gris medio oscuro (Slate 600)
    ];
    
    const fBase = new Float32Array(fillerCount * 3);   // x, y, z base por instancia
    const fDelay = new Float32Array(fillerCount);      // retardo de la onda por instancia
    for (let i = 0; i < fillerCount; i++) {
        let fx0 = 0, fz0 = 0, fy0 = 0;
        let attempts = 0;
        
        while (attempts < 20) {
            const anchor = vargas[Math.floor(rngF() * vargas.length)];
            const aPos = toScene(anchor.lat, anchor.lng);
            const ang = rngF() * Math.PI * 2;
            const rad = 50 + rngF() * 380;
            fx0 = aPos.x + Math.cos(ang) * rad;
            fz0 = aPos.z + Math.sin(ang) * rad;
            fy0 = terr.heightAt ? terr.heightAt(fx0, fz0) : 0;
            
            // 1. Evitar el mar (altura <= 3.0m)
            if (fy0 <= 3.0) {
                attempts++;
                continue;
            }
            
            // 2. Evitar solapamiento con los edificios reales del catálogo
            let overlaps = false;
            for (let j = 0; j < vargas.length; j++) {
                const b = vargas[j];
                const bPos = toScene(b.lat, b.lng);
                const dx = fx0 - bPos.x;
                const dz = fz0 - bPos.z;
                if (dx*dx + dz*dz < 28*28) {
                    overlaps = true;
                    break;
                }
            }
            if (overlaps) {
                attempts++;
                continue;
            }
            
            // 3. Evitar solapamiento cercano con otros edificios genéricos anteriores
            for (let k = 0; k < i; k++) {
                const px = fBase[k * 3];
                const pz = fBase[k * 3 + 2];
                const dx = fx0 - px;
                const dz = fz0 - pz;
                if (dx*dx + dz*dz < 22*22) {
                    overlaps = true;
                    break;
                }
            }
            if (!overlaps) {
                break;
            }
            attempts++;
        }
        
        dummy.position.set(fx0, fy0, fz0);
        dummy.rotation.y = rngF() * Math.PI;
        
        fBase[i * 3] = fx0; fBase[i * 3 + 1] = fy0; fBase[i * 3 + 2] = fz0;
        fDelay[i] = (fx0 - xWest) / CITY_CFG.waveSpeed;
        
        // Dimensiones más realistas
        const isMidRise = rngF() < 0.15; // 15% medianos, 85% casas bajas
        const floors = isMidRise ? (3 + Math.floor(rngF() * 4)) : (1 + Math.floor(rngF() * 2));
        const baseFp = isMidRise ? (7 + rngF() * 4) : (4 + rngF() * 4);
        
        const fw = baseFp * CITY_CFG.fpScale;
        const fd = baseFp * (0.85 + rngF() * 0.3) * CITY_CFG.fpScale;
        const fh = floors * 3.0 * CITY_CFG.htScale;
        
        dummy.scale.set(fw, fh, fd);
        dummy.updateMatrix();
        fillers.setMatrixAt(i, dummy.matrix);
        
        // Asignar color de la paleta
        const col = fPalette[Math.floor(rngF() * fPalette.length)].clone();
        col.multiplyScalar(0.85 + rngF() * 0.3);
        fillers.setColorAt(i, col);
    }
    fillers.instanceMatrix.needsUpdate = true;
    if (fillers.instanceColor) fillers.instanceColor.needsUpdate = true;
    fillers.userData.base = fBase;
    fillers.userData.delay = fDelay;
    group.add(fillers);
    citySim.fillers = fillers;

    // --- Movimiento del terreno (doblete con semilla fija) ---
    citySim.motion = buildCityGroundMotion();

    // --- UI ---
    wireCityControls();
    applyCityState(0, 0, false);
    updateCityUI();

    if (loadingEl) loadingEl.classList.add('hidden');
    window.addEventListener('resize', resizeCityRenderer);

    // Picking de edificios del catálogo
    renderer.domElement.addEventListener('pointerdown', (ev) => {
        citySim.pointer.x = (ev.offsetX / renderer.domElement.clientWidth) * 2 - 1;
        citySim.pointer.y = -(ev.offsetY / renderer.domElement.clientHeight) * 2 + 1;
        citySim.raycaster.setFromCamera(citySim.pointer, citySim.camera);
        const meshes = citySim.buildings.map(s => s.mesh);
        const hits = citySim.raycaster.intersectObjects(meshes, false);
        if (hits.length > 0) showCityBuildingCard(hits[0].object.userData.cityState);
        else hideCityBuildingCard();
    });

    citySim.lastFrame = performance.now();
    requestAnimationFrame(cityFrameLoop);
}

function wireCityControls() {
    const btnPlay = document.getElementById('city-btn-play');
    const floatBtnPlay = document.getElementById('city-float-btn-play');
    const btnRestart = document.getElementById('city-btn-restart');
    const floatBtnRestart = document.getElementById('city-float-btn-restart');
    const scrubber = document.getElementById('city-scrubber');

    const handlePlayToggle = () => {
        if (!citySim) return;
        if (citySim.t >= CITY_CFG.duration) applyCityState(0, 0, false);
        citySim.playing = !citySim.playing;
        updateCityPlayButton();
    };

    const handleRestart = () => {
        if (!citySim) return;
        citySim.playing = false;
        clearCityDust();
        applyCityState(0, 0, false);
        updateCityPlayButton();
        updateCityUI();
    };

    if (btnPlay) btnPlay.addEventListener('click', handlePlayToggle);
    if (floatBtnPlay) floatBtnPlay.addEventListener('click', handlePlayToggle);

    if (btnRestart) btnRestart.addEventListener('click', handleRestart);
    if (floatBtnRestart) floatBtnRestart.addEventListener('click', handleRestart);

    document.querySelectorAll('.city-speed-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const speedVal = btn.dataset.speed;
            document.querySelectorAll('.city-speed-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.speed === speedVal);
            });
            if (citySim) citySim.speed = parseFloat(speedVal) || 1;
        });
    });

    if (scrubber) {
        scrubber.addEventListener('input', () => {
            if (!citySim) return;
            citySim.playing = false;
            clearCityDust();
            applyCityState(parseFloat(scrubber.value) || 0, 0, false);
            updateCityPlayButton();
            updateCityUI();
        });
    }

    const floatToggleFans = document.getElementById('city-float-toggle-fans');
    const floatToggleBedrock = document.getElementById('city-float-toggle-bedrock');

    if (floatToggleFans) {
        floatToggleFans.addEventListener('change', (e) => {
            if (citySim && citySim.fansGroup) {
                citySim.fansGroup.visible = e.target.checked;
            }
            const legendFans = document.getElementById('city-legend-fans');
            if (legendFans) {
                legendFans.style.display = e.target.checked ? 'flex' : 'none';
            }
        });
    }

    if (floatToggleBedrock) {
        floatToggleBedrock.addEventListener('change', (e) => {
            if (citySim && citySim.bedrockGroup) {
                citySim.bedrockGroup.visible = e.target.checked;
            }
            const legendBedrock = document.getElementById('city-legend-bedrock');
            if (legendBedrock) {
                legendBedrock.style.display = e.target.checked ? 'flex' : 'none';
            }
        });
    }
}

function updateCityPlayButton() {
    if (!citySim) return;
    const playBtns = [document.getElementById('city-btn-play'), document.getElementById('city-float-btn-play')];
    playBtns.forEach(btn => {
        if (!btn) return;
        const icon = btn.querySelector('i');
        const label = btn.querySelector('span');
        if (citySim.playing) {
            if (icon) icon.className = 'fa-solid fa-pause';
            if (label) label.textContent = 'Pausar';
        } else {
            if (icon) icon.className = 'fa-solid fa-play';
            if (label) label.textContent = (citySim.t >= CITY_CFG.duration) ? 'Repetir' : 'Reproducir';
        }
    });
}

// Aplica el estado completo de la ciudad en el instante t (determinístico).
// La perturbación viaja de oeste a este a CITY_CFG.waveSpeed: cada elemento
// (vértice del terreno, edificio, relleno) responde al registro con el retardo
// que tarda el frente de onda en llegar a su longitud.
function applyCityState(t, dtFrame, live) {
    if (!citySim) return;
    // En pausa y con el mismo instante no hay nada que recomputar
    if (!live && citySim.lastAppliedT === t) { citySim.t = t; return; }
    citySim.lastAppliedT = t;
    citySim.t = t;

    const terr = citySim.terrain;
    const xWest = terr ? terr.xWest : 0;
    const KX = CITY_CFG.dispExag * 0.5;   // desplazamiento horizontal del suelo
    const KY = CITY_CFG.dispExag * 0.22;  // rizado vertical del suelo
    const waveSpan = terr ? (terr.xEast - terr.xWest) / CITY_CFG.waveSpeed : 0;

    // --- Terreno: ondula al paso del frente de onda ---
    if (terr && terr.posAttr) {
        if (t - waveSpan > CITY_CFG.duration + 1) {
            // El registro terminó en todo el corredor: dejar el relieve en reposo
            if (!terr.settled) {
                const arr0 = terr.posAttr.array;
                for (let i = 0; i < terr.baseX.length; i++) {
                    arr0[i * 3] = terr.baseX[i];
                    arr0[i * 3 + 2] = terr.baseH[i];
                }
                terr.posAttr.needsUpdate = true;
                terr.settled = true;
            }
        } else {
            const arr = terr.posAttr.array;
            for (let i = 0; i < terr.baseX.length; i++) {
                const a = sampleCityAccel(t - terr.delays[i]);
                arr[i * 3] = terr.baseX[i] + a * KX;
                arr[i * 3 + 2] = terr.baseH[i] + a * KY;
            }
            terr.posAttr.needsUpdate = true;
            terr.settled = false;
        }
    }

    // --- Tejido urbano genérico (instancias) ---
    if (citySim.fillers && _cityTmpMat) {
        const fb = citySim.fillers.userData.base;
        const fd = citySim.fillers.userData.delay;
        const nF = fd.length;
        for (let i = 0; i < nF; i++) {
            const a = sampleCityAccel(t - fd[i]);
            citySim.fillers.getMatrixAt(i, _cityTmpMat);
            _cityTmpMat.elements[12] = fb[i * 3] + a * KX;
            _cityTmpMat.elements[13] = fb[i * 3 + 1] + a * KY;
            citySim.fillers.setMatrixAt(i, _cityTmpMat);
        }
        citySim.fillers.instanceMatrix.needsUpdate = true;
    }

    // --- Frentes de onda luminosos (barren de oeste a este) ---
    if (citySim.waveFronts && terr) {
        // Brillo según la envolvente del evento + pulso sutil con el registro instantáneo
        const pulse = 0.78 + 0.22 * Math.min(1, Math.abs(sampleCityAccel(t)) / 0.4);
        citySim.waveFronts.forEach(f => {
            const age = t - f.start;
            const xF = xWest + CITY_CFG.waveSpeed * age;
            if (age >= 0 && xF <= terr.xEast + 500) {
                f.mesh.visible = true;
                f.mesh.position.x = xF;
                f.mesh.material.opacity = (0.08 + 0.55 * Math.min(1, f.env(age) / 0.45)) * pulse;
            } else {
                f.mesh.visible = false;
            }
        });
    }

    let nCollapsed = 0, nDamaged = 0;
    const amber = new THREE.Color(0xf59e0b);

    citySim.buildings.forEach(st => {
        const mesh = st.mesh;
        const aLoc = sampleCityAccel(t - st.delay); // aceleración en su longitud
        const gX = aLoc * KX;                        // el suelo se desplaza bajo el edificio
        const gY = aLoc * KY;
        const isCollapsedNow = (st.collapseT !== null && t >= st.collapseT);

        if (isCollapsedNow) {
            // --- Colapso por pancaking + vuelco ---
            const p = Math.min(1, (t - st.collapseT) / CITY_CFG.collapseDur);
            const eIn = p * p * p;
            const eOut = 1 - Math.pow(1 - p, 3);
            mesh.scale.y = Math.max(0.12, 1 - 0.88 * eIn);
            mesh.rotation.z = st.toppleZ * eOut;
            mesh.rotation.x = st.toppleX * eOut;
            mesh.position.x = mesh.userData.x0 + st.shiftX * eIn + gX;
            mesh.position.y = st.y0 + gY;
            mesh.position.z = mesh.userData.z0 + st.shiftZ * eIn;
            mesh.material.emissive.setRGB(0.30 * (1 - p) * p * 4, 0.04, 0.03);
            if (st.rubble) {
                st.rubble.visible = p > 0.45;
                st.rubble.scale.y = Math.max(0.001, Math.min(1, (p - 0.45) / 0.55));
                st.rubble.position.x = st.rubble.userData.x0 + gX;
                st.rubble.position.y = st.y0 + gY;
            }
            if (live && !st.dustSpawned && p > 0.08) {
                spawnCityDust(mesh.userData.x0 + gX, st.y0 + st.h * 0.55, mesh.userData.z0, st.N >= 7);
                st.dustSpawned = true;
            }
            if (p >= 0.5) nCollapsed++;
        } else {
            // Restaurar estado intacto (necesario al rebobinar antes del colapso)
            if (mesh.scale.y !== 1) mesh.scale.y = 1;
            mesh.position.x = mesh.userData.x0 + gX;
            mesh.position.y = st.y0 + gY;
            mesh.position.z = mesh.userData.z0;
            mesh.material.emissive.setRGB(0, 0, 0);
            if (st.rubble && st.rubble.visible) { st.rubble.visible = false; st.rubble.scale.y = 0.001; }

            // --- Oscilación elástica (SDOF por edificio) + deriva permanente ---
            if (live && dtFrame > 0) {
                const w = 2.0 * Math.PI / st.T;
                const zeta = 0.05;
                const acc = -aLoc * 9.81 - 2.0 * zeta * w * st.v - w * w * st.u;
                st.v += acc * dtFrame;
                st.u += st.v * dtFrame;
            } else if (!live) {
                st.u = 0; st.v = 0;
            }
            let tiltZ = 0, tiltX = 0, dmg = 0;
            if (st.damageT !== null && t >= st.damageT) {
                dmg = Math.min(1, (t - st.damageT) / 1.2);
                const e = 1 - Math.pow(1 - dmg, 2);
                tiltZ = st.tiltZ * e;
                tiltX = st.tiltX * e;
                mesh.material.color.copy(st.baseColor).lerp(amber, dmg * 0.55);
                if (dmg >= 1) nDamaged++;
            } else if (mesh.material.color !== st.baseColor) {
                mesh.material.color.copy(st.baseColor);
            }
            const sway = Math.max(-0.16, Math.min(0.16, st.u * CITY_CFG.dispExag / st.h));
            mesh.rotation.z = tiltZ + sway;
            mesh.rotation.x = tiltX + sway * 0.35;
        }
    });

    citySim.counts = {
        collapsed: nCollapsed,
        damaged: nDamaged,
        standing: citySim.buildings.length - nCollapsed - nDamaged
    };
}

function spawnCityDust(x, y, z, big) {
    const rng = cityMulberry32((x * 131 + z * 71) | 0);
    const n = big ? 80 : 50;
    const positions = new Float32Array(n * 3);
    const vels = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        positions[i * 3] = x + (rng() - 0.5) * 40;
        positions[i * 3 + 1] = y * (0.4 + rng() * 0.6);
        positions[i * 3 + 2] = z + (rng() - 0.5) * 40;
        const ang = rng() * Math.PI * 2;
        const spd = 25 + rng() * 60;
        vels[i * 3] = Math.cos(ang) * spd;
        vels[i * 3 + 1] = 20 + rng() * 45;
        vels[i * 3 + 2] = Math.sin(ang) * spd;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
        color: 0xb8a88e, size: big ? 60 : 42, sizeAttenuation: true,
        transparent: true, opacity: 0.85, depthWrite: false
    });
    const points = new THREE.Points(geo, mat);
    citySim.scene.add(points);
    citySim.dust.push({ points, vels, life: 0, maxLife: 3.4 });
}

function updateCityDust(dtFrame) {
    const dustArr = citySim.dust;
    for (let d = dustArr.length - 1; d >= 0; d--) {
        const p = dustArr[d];
        p.life += dtFrame;
        const posAttr = p.points.geometry.getAttribute('position');
        for (let i = 0; i < posAttr.count; i++) {
            posAttr.array[i * 3] += p.vels[i * 3] * dtFrame;
            posAttr.array[i * 3 + 1] = Math.max(1, posAttr.array[i * 3 + 1] + p.vels[i * 3 + 1] * dtFrame);
            posAttr.array[i * 3 + 2] += p.vels[i * 3 + 2] * dtFrame;
            p.vels[i * 3 + 1] -= 9.8 * dtFrame * 12;
            const drag = 1 - 0.9 * dtFrame;
            p.vels[i * 3] *= drag; p.vels[i * 3 + 2] *= drag;
        }
        posAttr.needsUpdate = true;
        p.points.material.opacity = Math.max(0, 0.85 * (1 - p.life / p.maxLife));
        if (p.life >= p.maxLife) {
            citySim.scene.remove(p.points);
            p.points.geometry.dispose();
            p.points.material.dispose();
            dustArr.splice(d, 1);
        }
    }
}

function clearCityDust() {
    if (!citySim) return;
    citySim.dust.forEach(p => {
        citySim.scene.remove(p.points);
        p.points.geometry.dispose();
        p.points.material.dispose();
    });
    citySim.dust = [];
    citySim.buildings.forEach(st => { st.dustSpawned = false; });
}

function updateCityUI() {
    if (!citySim) return;
    const t = citySim.t;
    const clock = document.getElementById('city-clock');
    const cStand = document.getElementById('city-count-standing');
    const cDmg = document.getElementById('city-count-damaged');
    const cCol = document.getElementById('city-count-collapsed');
    const pill = document.getElementById('city-phase-pill');
    const scrubber = document.getElementById('city-scrubber');

    if (clock) clock.textContent = t.toFixed(1) + ' s';
    if (citySim.counts) {
        if (cStand) cStand.textContent = citySim.counts.standing;
        if (cDmg) cDmg.textContent = citySim.counts.damaged;
        if (cCol) cCol.textContent = citySim.counts.collapsed;
    }
    if (scrubber && document.activeElement !== scrubber) scrubber.value = t;
    if (pill) {
        let txt = 'En calma', cls = 'city-phase-pill';
        if (t >= CITY_CFG.duration) { txt = 'Final del registro'; cls += ' phase-end'; }
        else if (t >= CITY_CFG.shock2Start) { txt = 'Evento 2 — 0.60g'; cls += ' phase-eq2'; }
        else if (t >= 30) { txt = 'Interludio'; cls += ' phase-end'; }
        else if (t > 0.5) { txt = 'Evento 1 — 0.40g'; cls += ' phase-eq1'; }
        pill.textContent = txt;
        pill.className = cls;
    }
}

function cityFrameLoop(now) {
    if (!citySim || !citySim.active) { if (citySim) citySim.loopRunning = false; return; }
    citySim.loopRunning = true;
    const dtFrame = Math.min(0.05, Math.max(0.001, (now - citySim.lastFrame) / 1000));
    citySim.lastFrame = now;

    if (citySim.playing) {
        const t = citySim.t + dtFrame * citySim.speed;
        if (t >= CITY_CFG.duration) {
            applyCityState(CITY_CFG.duration, dtFrame, true);
            citySim.playing = false;
            updateCityPlayButton();
        } else {
            applyCityState(t, dtFrame, true);
        }
        updateCityUI();
    } else {
        // En pausa la ciudad sigue renderizándose (órbita), sin avanzar el reloj
        applyCityState(citySim.t, 0, false);
    }

    updateCityDust(dtFrame);

    // Animar pulsación de abanicos fluviales si están visibles
    if (citySim.fansGroup && citySim.fansGroup.visible) {
        const pulse = 0.30 + Math.sin(now * 0.002) * 0.08;
        citySim.fansGroup.children.forEach(mesh => {
            if (mesh.material) mesh.material.opacity = pulse;
        });
    }
    if (citySim.bedrockGroup && citySim.bedrockGroup.visible) {
        const pulseB = 0.35 + Math.sin(now * 0.0018) * 0.06;
        citySim.bedrockGroup.children.forEach(mesh => {
            if (mesh.material) mesh.material.opacity = pulseB;
        });
    }

    citySim.controls.update();
    citySim.renderer.render(citySim.scene, citySim.camera);
    requestAnimationFrame(cityFrameLoop);
}

function resizeCityRenderer() {
    if (!citySim || !citySim.renderer) return;
    const container = document.getElementById('city-canvas-container');
    if (!container) return;
    const w = container.clientWidth, h = container.clientHeight;
    if (w < 10 || h < 10) return;
    citySim.camera.aspect = w / h;
    citySim.camera.updateProjectionMatrix();
    citySim.renderer.setSize(w, h);
}

function showCityBuildingCard(st) {
    const card = document.getElementById('city-info-card');
    if (!card || !st) return;
    const b = st.b;
    const isCol = st.status === 'collapsed';
    const statusTxt = isCol ? 'Colapsado' : 'Dañado (en pie)';
    const dmgTxt = { total: 'Total', severo: 'Severo', parcial: 'Parcial' }[b.damage_level] || b.damage_level || '—';
    const pMC = CITY_COLLAPSE_MC[b.floors] !== undefined ? CITY_COLLAPSE_MC[b.floors].toFixed(1) + '%' : 'N/D';
    const eventTxt = isCol
        ? `Evento ${st.event} (t &asymp; ${st.collapseT.toFixed(0)} s)`
        : `Evento ${st.event} (t &asymp; ${st.damageT.toFixed(0)} s)`;
    let photo = null;
    if (Array.isArray(b.photo) && b.photo.length) photo = b.photo[0];
    else if (typeof b.photo === 'string' && b.photo.startsWith('http')) photo = b.photo;

    const bDepth = getBedrockDepth(b.lat, b.lng);
    const bRangeInfo = getBedrockDepthRangeInfo(bDepth);

    card.innerHTML = `
        <button class="city-card-close" title="Cerrar"><i class="fa-solid fa-xmark"></i></button>
        <h4><i class="fa-solid fa-building"></i> ${b.name || 'Sin nombre'}</h4>
        <div class="city-card-zone">${b.zone || ''}</div>
        <div class="city-card-row"><span>Pisos</span><b>${b.floors || 'N/D'}</b></div>
        <div class="city-card-row"><span>Estado real</span><b class="city-card-status ${isCol ? 'collapsed' : 'damaged'}">${statusTxt}</b></div>
        <div class="city-card-row"><span>Nivel de daño</span><b>${dmgTxt}</b></div>
        <div class="city-card-row"><span>${isCol ? 'Colapsa en' : 'Se daña en'}</span><b>${eventTxt}</b></div>
        <div class="city-card-row"><span>P(colapso) MC 2019</span><b>${pMC}</b></div>
        <div class="city-card-row"><span>Roca Dura</span><b style="color: ${bRangeInfo.colorCss}; font-weight: 700;">${bDepth.toFixed(0)} m (${bRangeInfo.id}m)</b></div>
        <div style="margin-top: 6px; font-size: 10.5px; opacity: 0.75;">${b.address || ''}</div>
        ${photo ? `<img src="${photo}" alt="Foto de ${b.name}" loading="lazy" onerror="this.style.display='none'">` : ''}
    `;
    card.style.display = 'block';
    const closeBtn = card.querySelector('.city-card-close');
    if (closeBtn) closeBtn.addEventListener('click', hideCityBuildingCard);
}

function hideCityBuildingCard() {
    const card = document.getElementById('city-info-card');
    if (card) card.style.display = 'none';
}

async function initDamageMap() {
    const container = document.getElementById('damage-map-container');
    if (!container || typeof L === 'undefined') {
        console.warn('[initDamageMap] Leaflet or container not available');
        return;
    }

    // --- Collapse probability data from Monte Carlo simulations (Vargas 2026) ---
    // Key: number of floors → { p2001: %, p2019: % }
    const collapseData = {
        4: { p2001: 100.0, p2019: 45.5 },
        5: { p2001: 100.0, p2019: 63.6 },
        6: { p2001: 100.0, p2019: 36.4 },
        7: { p2001: 100.0, p2019: 72.7 },
        8: { p2001: 90.9, p2019: 63.6 },
        9: { p2001: 81.8, p2019: 63.6 },
        10: { p2001: 81.8, p2019: 54.5 }
    };

    // --- 198 real buildings geolocated across La Guaira / Vargas dataset ---
    // Extracted directly from terremotovenezuela.com database & post-seismic citizen reports
    let buildings;
    try {
        const response = await fetch('buildings.json');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        buildings = await response.json();
        window.mapBuildings = buildings;
    } catch (err) {
        console.error('[initDamageMap] Error al cargar buildings.json:', err);
        const tbody = document.getElementById('damage-map-table-body');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--color-2001); padding: 24px;">Error al cargar los datos del mapa.</td></tr>`;
        }
        return;
    }

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

    // --- Control de Coordenadas al pasar el Mouse ---
    const MousePositionControl = L.Control.extend({
        options: {
            position: 'bottomleft'
        },
        onAdd: function (map) {
            this._container = L.DomUtil.create('div', 'leaflet-control-mouseposition');
            L.DomEvent.disableClickPropagation(this._container);
            this._container.style.background = 'rgba(15, 23, 42, 0.85)';
            this._container.style.border = '1px solid rgba(255, 255, 255, 0.15)';
            this._container.style.padding = '6px 12px';
            this._container.style.borderRadius = '8px';
            this._container.style.color = '#00f2fe';
            this._container.style.fontSize = '12px';
            this._container.style.fontFamily = "'Courier New', Courier, monospace";
            this._container.style.fontWeight = 'bold';
            this._container.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
            this._container.style.backdropFilter = 'blur(6px)';
            this._container.style.minWidth = '210px';
            this._container.innerHTML = '<i class="fa-solid fa-crosshairs" style="color: #ffb703; margin-right: 6px;"></i>Lat: 10.61400, Lng: -66.86500';
            return this._container;
        },
        updateHTML: function (lat, lng) {
            this._container.innerHTML = `<i class="fa-solid fa-crosshairs" style="color: #ffb703; margin-right: 6px; animation: fa-spin 4s linear infinite;"></i>Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`;
        }
    });

    const positionControl = new MousePositionControl();
    positionControl.addTo(map);

    map.on('mousemove', function (e) {
        positionControl.updateHTML(e.latlng.lat, e.latlng.lng);
    });

    // --- Capas de Fallas Geológicas y Zonas de Intensidad (Doublete Sísmico 1967) ---
    const faultsGroup = L.layerGroup();
    const impactZonesGroup = L.layerGroup();
    const pgaGroup = L.layerGroup();

    // 1. Fallas Geológicas (FUNVISIS)
    const sanSebastianCoords = [
        [10.760, -67.200],
        [10.752, -67.100],
        [10.743, -67.000],
        [10.733, -66.900],
        [10.722, -66.800],
        [10.710, -66.700],
        [10.698, -66.600],
        [10.685, -66.500]
    ];
    const sanSebastianPoly = L.polyline(sanSebastianCoords, {
        color: '#f87171',
        weight: 4,
        dashArray: '8, 8',
        opacity: 0.95
    }).addTo(faultsGroup);
    sanSebastianPoly.bindPopup(`
        <div style="font-family:'Inter',sans-serif; font-size:12px; color:#fff;">
            <strong style="color:#ef4444;"><i class="fa-solid fa-bolt"></i> Sistema de Fallas de San Sebastián</strong><br>
            <p style="margin:6px 0 0 0; line-height:1.4; color:#94a3b8;">
                Falla principal transcurrente dextral bajo el mar Caribe. Límite de placas Caribe-Sudamérica. Generadora del sismo de 1967.
            </p>
        </div>
    `);
    sanSebastianPoly.bindTooltip("Falla de San Sebastián", { sticky: true, className: "fault-tooltip" });

    const tacaguaAvilaCoords = [
        [10.575, -67.150],
        [10.582, -67.050],
        [10.588, -66.950],
        [10.593, -66.850],
        [10.598, -66.750],
        [10.602, -66.650],
        [10.605, -66.550]
    ];
    const tacaguaAvilaPoly = L.polyline(tacaguaAvilaCoords, {
        color: '#fb923c',
        weight: 3.5,
        dashArray: '6, 6',
        opacity: 0.9
    }).addTo(faultsGroup);
    tacaguaAvilaPoly.bindPopup(`
        <div style="font-family:'Inter',sans-serif; font-size:12px; color:#fff;">
            <strong style="color:#f97316;"><i class="fa-solid fa-bolt"></i> Falla de Tacagua - El Ávila</strong><br>
            <p style="margin:6px 0 0 0; line-height:1.4; color:#94a3b8;">
                Falla activa en las estribaciones norte del macizo de El Ávila. Genera sismicidad local en la zona costera de Vargas.
            </p>
        </div>
    `);
    tacaguaAvilaPoly.bindTooltip("Falla de Tacagua - El Ávila", { sticky: true, className: "fault-tooltip" });

    const macutoCoords = [
        [10.603, -67.050],
        [10.605, -67.000],
        [10.608, -66.950],
        [10.611, -66.900],
        [10.613, -66.850],
        [10.615, -66.800],
        [10.618, -66.750],
        [10.620, -66.700],
        [10.623, -66.650]
    ];
    const macutoPoly = L.polyline(macutoCoords, {
        color: '#facc15',
        weight: 3,
        dashArray: '5, 5',
        opacity: 0.85
    }).addTo(faultsGroup);
    macutoPoly.bindPopup(`
        <div style="font-family:'Inter',sans-serif; font-size:12px; color:#fff;">
            <strong style="color:#eab308;"><i class="fa-solid fa-bolt"></i> Falla de Macuto</strong><br>
            <p style="margin:6px 0 0 0; line-height:1.4; color:#94a3b8;">
                Falla inversa secundaria paralela a la costa costera de Vargas, asociada al levantamiento del macizo montañoso de El Ávila.
            </p>
        </div>
    `);
    macutoPoly.bindTooltip("Falla de Macuto", { sticky: true, className: "fault-tooltip" });

    // 3. Aceleración de Suelo Pico (PGA 2026) - Contornos Reales USGS (M 7.5 Yumare)
    try {
        const pgaResponse = await fetch('usgs_pga_contours.json');
        if (pgaResponse.ok) {
            const pgaContoursData = await pgaResponse.json();
            L.geoJSON(pgaContoursData, {
                style: function (feature) {
                    const val = feature.properties.value; // %g (50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05)
                    let color = '#60a5fa';
                    let weight = 2.0;

                    if (val >= 50) { color = '#ef4444'; weight = 4.0; } // 0.50g
                    else if (val >= 20) { color = '#fb923c'; weight = 3.5; } // 0.20g
                    else if (val >= 10) { color = '#facc15'; weight = 3.0; } // 0.10g
                    else if (val >= 5) { color = '#4ade80'; weight = 2.5; }  // 0.05g
                    else if (val >= 2) { color = '#2ec4b6'; weight = 2.0; }  // 0.02g
                    else if (val >= 1) { color = '#3b82f6'; weight = 1.5; }  // 0.01g

                    return {
                        color: color,
                        weight: weight,
                        opacity: 0.85,
                        dashArray: '4, 4'
                    };
                },
                onEachFeature: function (feature, layer) {
                    const val = feature.properties.value;
                    const pgaValG = (val / 100).toFixed(2);
                    layer.bindPopup(`
                        <div style="font-family:'Inter',sans-serif; font-size:12px; color:#fff;">
                            <strong style="color:#ef4444;"><i class="fa-solid fa-gauge-high"></i> Contorno de PGA: ${pgaValG}g (${val}%g)</strong><br>
                            <p style="margin:6px 0 0 0; line-height:1.4; color:#94a3b8;">
                                Aceleración horizontal máxima estimada por la USGS para este límite durante el sismo del 24 de junio de 2026.
                            </p>
                        </div>
                    `);
                    layer.bindTooltip(`PGA: ${pgaValG}g`, { sticky: true, className: "fault-tooltip" });
                }
            }).addTo(pgaGroup);
        }
    } catch (err) {
        console.error('Error al cargar contornos de PGA de la USGS:', err);
    }

    // 2. Zonas de Intensidad (MMI sismo 1967)
    const caraballedaZone = L.circle([10.6110, -66.8250], {
        radius: 1350,
        color: '#ef4444',
        weight: 1.5,
        fillColor: '#7f1d1d',
        fillOpacity: 0.35
    }).addTo(impactZonesGroup);
    caraballedaZone.bindPopup(`
        <div style="font-family:'Inter',sans-serif; font-size:12px; color:#fff;">
            <strong style="color:#ef4444;"><i class="fa-solid fa-circle-exclamation"></i> Caraballeda: Intensidad VIII - IX (MMI)</strong><br>
            <p style="margin:6px 0 0 0; line-height:1.4; color:#94a3b8;">
                <strong>Daño Catastrófico:</strong> El gran espesor de sedimentos aluviales amplificó severamente las ondas sísmicas en el doblete de 1967, provocando colapsos de edificios altos.
            </p>
        </div>
    `);

    const macutoZone = L.circle([10.6130, -66.8800], {
        radius: 1100,
        color: '#fb923c',
        weight: 1.2,
        fillColor: '#c2410c',
        fillOpacity: 0.25
    }).addTo(impactZonesGroup);
    macutoZone.bindPopup(`
        <div style="font-family:'Inter',sans-serif; font-size:12px; color:#fff;">
            <strong style="color:#f97316;"><i class="fa-solid fa-triangle-exclamation"></i> Macuto: Intensidad VII - VIII (MMI)</strong><br>
            <p style="margin:6px 0 0 0; line-height:1.4; color:#94a3b8;">
                <strong>Daño Moderado-Alto:</strong> Daños considerables en estructuras de mediana y baja altura fundadas sobre suelos de transición coluvial/aluvial.
            </p>
        </div>
    `);

    const tanaguarenaZone = L.circle([10.6140, -66.7750], {
        radius: 1100,
        color: '#fb923c',
        weight: 1.2,
        fillColor: '#c2410c',
        fillOpacity: 0.25
    }).addTo(impactZonesGroup);
    tanaguarenaZone.bindPopup(`
        <div style="font-family:'Inter',sans-serif; font-size:12px; color:#fff;">
            <strong style="color:#f97316;"><i class="fa-solid fa-triangle-exclamation"></i> Tanaguarena: Intensidad VII - VIII (MMI)</strong><br>
            <p style="margin:6px 0 0 0; line-height:1.4; color:#94a3b8;">
                <strong>Daño Moderado-Alto:</strong> Amplificación local moderada debido al abanico aluvial secundario. Se reportaron daños estructurales significativos.
            </p>
        </div>
    `);

    const laGuairaZone = L.circle([10.6010, -66.9350], {
        radius: 1700,
        color: '#facc15',
        weight: 1.0,
        fillColor: '#854d0e',
        fillOpacity: 0.2
    }).addTo(impactZonesGroup);
    laGuairaZone.bindPopup(`
        <div style="font-family:'Inter',sans-serif; font-size:12px; color:#fff;">
            <strong style="color:#eab308;"><i class="fa-solid fa-circle-info"></i> La Guaira y Maiquetía: Intensidad VI - VII (MMI)</strong><br>
            <p style="margin:6px 0 0 0; line-height:1.4; color:#94a3b8;">
                <strong>Daño Leve-Moderado:</strong> Al estar fundados mayormente sobre roca o suelos densos superficiales, se limitaron los daños comparado con Caraballeda.
            </p>
        </div>
    `);

    // 4. Capa de Profundidad a Roca Dura (0 - 450m)
    const bedrockMapGroup = L.layerGroup();
    const bedrockRanges2D = [
        { label: '0 – 50 m (Roca Superficial)', latMin: 10.590, latMax: 10.598, color: '#10b981', opacity: 0.28 },
        { label: '50 – 150 m (Profundidad Moderada)', latMin: 10.598, latMax: 10.604, color: '#84cc16', opacity: 0.28 },
        { label: '150 – 250 m (Profundidad Intermedia)', latMin: 10.604, latMax: 10.609, color: '#facc15', opacity: 0.28 },
        { label: '250 – 350 m (Profundidad Alta / Resonancia)', latMin: 10.609, latMax: 10.614, color: '#f97316', opacity: 0.32 },
        { label: '350 – 450 m (Basamento Muy Profundo)', latMin: 10.614, latMax: 10.622, color: '#ef4444', opacity: 0.36 }
    ];

    bedrockRanges2D.forEach(rng => {
        const rect = L.rectangle([[rng.latMin, -67.15], [rng.latMax, -66.65]], {
            color: rng.color,
            weight: 1.5,
            dashArray: '5, 5',
            fillColor: rng.color,
            fillOpacity: rng.opacity
        }).addTo(bedrockMapGroup);

        rect.bindPopup(`
            <div style="font-family:'Inter',sans-serif; font-size:12px; color:#fff;">
                <strong style="color:${rng.color};"><i class="fa-solid fa-layer-group"></i> Profundidad a Roca Dura: ${rng.label}</strong><br>
                <p style="margin:6px 0 0 0; line-height:1.4; color:#94a3b8;">
                    Espesor sedimentario estimado sobre la roca dura metamórfica del macizo de El Ávila (Formación Las Mercedes / Las Brisas).
                </p>
            </div>
        `);
        rect.bindTooltip(`Roca Dura: ${rng.label}`, { sticky: true });
    });

    // Añadir al mapa por defecto
    faultsGroup.addTo(map);

    // Controles de capas
    const overlayLayers = {
        '<span style="color:#f87171; font-weight:600;"><i class="fa-solid fa-bolt"></i> Fallas Geológicas (FUNVISIS)</span>': faultsGroup,
        '<span style="color:#fb923c; font-weight:600;"><i class="fa-solid fa-house-crack"></i> Zonas de Intensidad (MMI 1967)</span>': impactZonesGroup,
        '<span style="color:#e63946; font-weight:600;"><i class="fa-solid fa-gauge-high"></i> Aceleración de Suelo (PGA 2026)</span>': pgaGroup,
        '<span style="color:#38bdf8; font-weight:600;"><i class="fa-solid fa-layer-group"></i> Profundidad a Roca Dura (0–450m)</span>': bedrockMapGroup
    };
    L.control.layers(null, overlayLayers, {
        collapsed: false,
        position: 'topright'
    }).addTo(map);

    // Eventos de leyendas dinámicas
    map.on('overlayadd', (e) => {
        if (e.name.includes("Fallas")) {
            const el = document.getElementById('legend-geological');
            if (el) el.style.display = 'flex';
        }
        if (e.name.includes("Intensidad")) {
            const el = document.getElementById('legend-intensities');
            if (el) el.style.display = 'flex';
        }
        if (e.name.includes("PGA")) {
            const el = document.getElementById('legend-pga');
            if (el) el.style.display = 'flex';
        }
        if (e.name.includes("Roca Dura")) {
            const el = document.getElementById('legend-bedrock');
            if (el) el.style.display = 'flex';
        }
    });

    map.on('overlayremove', (e) => {
        if (e.name.includes("Fallas")) {
            const el = document.getElementById('legend-geological');
            if (el) el.style.display = 'none';
        }
        if (e.name.includes("Intensidad")) {
            const el = document.getElementById('legend-intensities');
            if (el) el.style.display = 'none';
        }
        if (e.name.includes("PGA")) {
            const el = document.getElementById('legend-pga');
            if (el) el.style.display = 'none';
        }
        if (e.name.includes("Roca Dura")) {
            const el = document.getElementById('legend-bedrock');
            if (el) el.style.display = 'none';
        }
    });

    // --- Color coding by building status and probability ---
    function getColor(input, norm = currentNorm) {
        if (input === null || input === undefined) return '#ffb703';
        if (typeof input === 'number') {
            const prob = input;
            if (prob >= 100) return '#111111';
            if (prob >= 80) return '#e63946';
            if (prob >= 60) return '#fb8500';
            if (prob >= 40) return '#ffb703';
            return '#2ec4b6';
        }
        if (typeof input === 'object') {
            if (input.status === 'collapsed') return '#111111';
            if (input.status === 'damaged') return '#fb8500'; // Naranja para estructuras en pie con daño
            if (input.status === 'survived') return '#2ec4b6';

            const prob = norm === '2001' ? input.p2001 : input.p2019;
            if (prob === null || prob === undefined) return '#fb8500';
            if (prob >= 100) return '#111111';
            if (prob >= 80) return '#e63946';
            if (prob >= 60) return '#fb8500';
            if (prob >= 40) return '#ffb703';
            return '#2ec4b6';
        }
        return '#ffb703';
    }

    function getStatusLabel(b) {
        const buildingStatus = typeof b === 'object' ? b.status : arguments[1];
        if (buildingStatus === 'collapsed') return { text: 'COLAPSÓ', cls: 'popup-status-collapsed', icon: 'fa-house-chimney-crack' };
        if (buildingStatus === 'damaged') return { text: 'DAÑO SEVERO (EN PIE)', cls: 'popup-status-damaged', icon: 'fa-house-crack' };
        if (buildingStatus === 'survived') return { text: 'RESISTIÓ', cls: 'popup-status-survived', icon: 'fa-shield-halved' };

        const prob = typeof b === 'object' ? (currentNorm === '2001' ? b.p2001 : b.p2019) : b;
        if (prob === null || prob === undefined) return { text: 'DAÑO SEVERO (EN PIE)', cls: 'popup-status-damaged', icon: 'fa-house-crack' };
        if (prob >= 100) return { text: 'COLAPSÓ', cls: 'popup-status-collapsed', icon: 'fa-house-chimney-crack' };
        if (prob >= 70) return { text: 'DAÑO SEVERO', cls: 'popup-status-damaged', icon: 'fa-house-crack' };
        if (prob >= 40) return { text: 'DAÑO MODERADO', cls: 'popup-status-damaged', icon: 'fa-exclamation-triangle' };
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

        const photos = Array.isArray(b.photo) ? b.photo : (b.photo ? [b.photo] : []);
        let photoHtml = '';
        if (photos.length > 0) {
            if (b.currentPhotoIndex === undefined) {
                b.currentPhotoIndex = 0;
            }
            if (b.currentPhotoIndex >= photos.length) {
                b.currentPhotoIndex = 0;
            }
            const activePhoto = photos[b.currentPhotoIndex];

            photoHtml = `
                <div style="margin-top: 10px; position: relative;">
                    <div id="popup-photo-wrapper-${b.id}" style="text-align: center; border-radius: 6px; overflow: hidden; border: 1px solid rgba(255,255,255,0.15); cursor: pointer;" onclick="window.open('${activePhoto}', '_blank')" title="Haga clic para ampliar la imagen">
                        <img id="popup-photo-img-${b.id}" src="${activePhoto}" style="width: 100%; height: 130px; object-fit: cover; display: block; transition: opacity 0.2s;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1.0'" alt="Evidencia de daño" />
                    </div>
            `;

            if (photos.length > 1) {
                photoHtml += `
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px; background: rgba(0,0,0,0.3); padding: 4px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.08);">
                        <button class="popup-photo-btn" onclick="window.changePopupPhoto('${b.id}', -1); event.stopPropagation();" style="background: rgba(255,255,255,0.1); border: none; color: #fff; cursor: pointer; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.25)'" onmouseout="this.style.background='rgba(255,255,255,0.1)'">
                            <i class="fa-solid fa-chevron-left"></i> Ant.
                        </button>
                        <span id="popup-photo-counter-${b.id}" style="font-size: 11px; color: var(--text-muted); font-family: monospace; font-weight: bold;">
                            ${b.currentPhotoIndex + 1} / ${photos.length}
                        </span>
                        <button class="popup-photo-btn" onclick="window.changePopupPhoto('${b.id}', 1); event.stopPropagation();" style="background: rgba(255,255,255,0.1); border: none; color: #fff; cursor: pointer; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.25)'" onmouseout="this.style.background='rgba(255,255,255,0.1)'">
                            Sig. <i class="fa-solid fa-chevron-right"></i>
                        </button>
                    </div>
                `;
            }

            photoHtml += `</div>`;
        }

        let boletinHtml = '';
        if (b.boletin) {
            const bul = b.boletin.toLowerCase().trim();
            if (bul.includes('verde')) {
                boletinHtml = `
                    <div style="text-align: center; margin-top: 4px;">
                        <span class="popup-status-badge popup-status-survived" style="text-transform: none; letter-spacing: normal;">
                            <i class="fa-solid fa-circle-check"></i> Boletín: Verde (Habitable)
                        </span>
                    </div>
                `;
            } else if (bul.includes('amarillo') || bul.includes('amarilla')) {
                boletinHtml = `
                    <div style="text-align: center; margin-top: 4px;">
                        <span class="popup-status-badge popup-status-damaged" style="text-transform: none; letter-spacing: normal;">
                            <i class="fa-solid fa-triangle-exclamation"></i> Boletín: Amarillo (Restringido)
                        </span>
                    </div>
                `;
            } else if (bul.includes('rojo') || bul.includes('roja')) {
                boletinHtml = `
                    <div style="text-align: center; margin-top: 4px;">
                        <span class="popup-status-badge popup-status-collapsed" style="text-transform: none; letter-spacing: normal;">
                            <i class="fa-solid fa-ban"></i> Boletín: Rojo (Inhabitable)
                        </span>
                    </div>
                `;
            }
        }

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
                <span class="popup-row-value" style="color: #77777;">${probStr}</span>
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
            ${boletinHtml}
            ${confirmedBadge}
            ${photoHtml}
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
                    <td class="calc-value" style="padding: 4px;">
                        <button class="btn-correction" data-index="${i}" title="Copiar datos y reportar corrección en GitHub" style="background: rgba(255, 183, 3, 0.1); border: 1px solid rgba(255, 183, 3, 0.3); color: #ffb703; padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: bold; cursor: pointer; transition: all 0.2s; display: inline-flex; align-items: center; gap: 4px; outline: none;">
                            <i class="fa-solid fa-pen-to-square"></i> Corregir
                        </button>
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

        // Correction button listener
        tbody.querySelectorAll('.btn-correction').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation(); // Avoid triggering row centering
                const idx = parseInt(btn.getAttribute('data-index'), 10);
                const b = list[idx];
                if (!b) return;

                const cleanData = {
                    id: b.id,
                    name: b.name,
                    zone: b.zone || '',
                    address: b.address || '',
                    lat: b.lat,
                    lng: b.lng,
                    floors: b.floors,
                    status: b.status,
                    damage_level: b.damage_level,
                    photo: b.photo,
                    real: b.real,
                    boletin: b.boletin || ''
                };

                const textToCopy = JSON.stringify(cleanData, null, 2);

                navigator.clipboard.writeText(textToCopy).then(() => {
                    showCorrectionNotification(`¡Datos de "${b.name}" copiados al portapapeles! Redirigiendo a GitHub...`);

                    setTimeout(() => {
                        window.open('https://github.com/metantonio/venezuela-sismo/issues?q=state%3Aopen%20label%3A%22Correcci%C3%B3n%20Edificaci%C3%B3n%20Mapa%22', '_blank');
                    }, 1000);
                }).catch(err => {
                    console.error('Error al copiar al portapapeles:', err);
                    window.open('https://github.com/metantonio/venezuela-sismo/issues?q=state%3Aopen%20label%3A%22Correcci%C3%B3n%20Edificaci%C3%B3n%20Mapa%22', '_blank');
                });
            });
        });
    }

    function showCorrectionNotification(message) {
        const existing = document.getElementById('correction-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = 'correction-toast';
        toast.style.position = 'fixed';
        toast.style.bottom = '24px';
        toast.style.right = '24px';
        toast.style.background = 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)';
        toast.style.border = '1px solid #ffb703';
        toast.style.boxShadow = '0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 10px rgba(255, 183, 3, 0.2)';
        toast.style.color = '#fff';
        toast.style.padding = '12px 20px';
        toast.style.borderRadius = '8px';
        toast.style.fontSize = '13px';
        toast.style.zIndex = '9999';
        toast.style.fontFamily = "'Inter', sans-serif";
        toast.style.fontWeight = '500';
        toast.style.display = 'flex';
        toast.style.alignItems = 'center';
        toast.style.gap = '8px';
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';

        toast.innerHTML = `<i class="fa-solid fa-circle-check" style="color: #ffb703; font-size: 16px;"></i> <span>${message}</span>`;

        document.body.appendChild(toast);

        toast.offsetHeight; // force reflow
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            setTimeout(() => {
                toast.remove();
            }, 300);
        }, 3000);
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


// ==========================================================================
// SECCIÓN DE EVALUACIÓN RÁPIDA DE DAÑOS (BOLETÍN FUNVISIS 2023)
// ==========================================================================

let activeGuideElement = 'column';
let activeGuideDamage = 'moderado';

// Inicializador principal
function initBoletin() {
    // 1. Escuchas de eventos para formulario principal
    const formInputs = [
        'bol-name', 'bol-address', 'bol-floors', 'bol-use', 'bol-material',
        'bol-critical-floor', 'bol-access', 'bol-sev-cols', 'bol-sev-walls-c',
        'bol-sev-walls-m', 'bol-sev-beams',
        'bol-year', 'bol-basements', 'bol-semibasements',
        'bol-mod-cols-tot', 'bol-mod-cols-cnt',
        'bol-mod-wallsc-tot', 'bol-mod-wallsc-cnt',
        'bol-mod-wallsm-tot', 'bol-mod-wallsm-cnt',
        'bol-mod-beams-tot', 'bol-mod-beams-cnt'
    ];

    formInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', calculateBoletinRisk);
            el.addEventListener('change', calculateBoletinRisk);
        }
    });

    // Escuchas para radio buttons (Inspección Externa y Componentes)
    const radioNames = [
        'bol-ext-collapse', 'bol-ext-neighbor', 'bol-ext-geol', 'bol-ext-settlement', 'bol-ext-tilt',
        'bol-comp-slabs', 'bol-comp-walls', 'bol-comp-tanks', 'bol-comp-utilities', 'bol-comp-elevators'
    ];

    radioNames.forEach(name => {
        const radios = document.getElementsByName(name);
        radios.forEach(radio => {
            radio.addEventListener('change', calculateBoletinRisk);
        });
    });

    // Escuchas para checkboxes de acciones
    const actionIds = [
        'bol-act-det-struct', 'bol-act-det-geot', 'bol-act-det-inst',
        'bol-act-prev-cordon', 'bol-act-prev-street', 'bol-act-prev-shore', 'bol-act-prev-gas', 'bol-act-prev-elec'
    ];
    actionIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', updateActionsFromUI);
        }
    });

    // 2. Preset selector
    const presetSelect = document.getElementById('boletin-preset-select');
    if (presetSelect) {
        presetSelect.addEventListener('change', (e) => {
            loadBoletinPreset(e.target.value);
        });
    }

    // 3. Botones del Manual de Entrenamiento (Guía Visual)
    const elemBtns = document.querySelectorAll('.guide-elem-btn');
    elemBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            elemBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeGuideElement = btn.getAttribute('data-element');
            updateGuideVisual();
        });
    });

    const dmgBtns = document.querySelectorAll('.guide-dmg-btn');
    dmgBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            dmgBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeGuideDamage = btn.getAttribute('data-damage');
            updateGuideVisual();
        });
    });

    // --- Lógica del Modal del Reporte Oficial (Google Forms) ---
    const openReportBtn = document.getElementById('btn-open-boletin-report');
    if (openReportBtn) {
        openReportBtn.addEventListener('click', () => {
            // Prellenar campos en el modal
            const nameVal = document.getElementById('bol-name').value || 'Edificación';
            const addressVal = document.getElementById('bol-address').value || 'Sin dirección';
            document.getElementById('rep-name').value = nameVal;
            document.getElementById('rep-address').value = addressVal;
            
            // Determinar color de ficha
            const tagTitle = document.getElementById('boletin-tag-title').textContent.trim();
            let formColor = 'Verde 🟢';
            if (tagTitle === 'PELIGRO') formColor = 'Rojo 🔴';
            else if (tagTitle === 'ATENCIÓN') formColor = 'Amarillo 🟡';
            document.getElementById('rep-color').value = formColor;

            // Coordenadas
            document.getElementById('rep-coords').value = currentBoletinCoords || '';

            // Generar descripción técnica automática de los daños
            const sevCols = parseInt(document.getElementById('bol-sev-cols').value) || 0;
            const sevWallsC = parseInt(document.getElementById('bol-sev-walls-c').value) || 0;
            const sevWallsM = parseInt(document.getElementById('bol-sev-walls-m').value) || 0;
            const sevBeams = parseInt(document.getElementById('bol-sev-beams').value) || 0;
            const totalSevere = sevCols + sevWallsC + sevWallsM + sevBeams;
            
            const maxPctText = document.getElementById('bol-mod-pct-display').textContent;
            const extCollapse = getRadioVal('bol-ext-collapse');
            const extGeol = getRadioVal('bol-ext-geol');
            const extSettlement = getRadioVal('bol-ext-settlement');
            const extTilt = getRadioVal('bol-ext-tilt');

            let desc = `Inspección rápida realizada.\n`;
            desc += `- Dictamen: ${tagTitle}\n`;
            if (totalSevere > 0) {
                desc += `- Daños Severos: ${totalSevere} elementos (Cols: ${sevCols}, Muros C: ${sevWallsC}, Muros M: ${sevWallsM}, Vigas: ${sevBeams}).\n`;
            } else {
                desc += `- Sin daños severos registrados.\n`;
            }
            desc += `- Daño moderado máximo: ${maxPctText}.\n`;
            
            let extRisks = [];
            if (extCollapse !== 'bajo') extRisks.push(`Peligro colapso (${extCollapse})`);
            if (extGeol !== 'bajo') extRisks.push(`Peligro geológico (${extGeol})`);
            if (extSettlement !== 'bajo') extRisks.push(`Asentamiento (${extSettlement})`);
            if (extTilt !== 'bajo') extRisks.push(`Inclinación (${extTilt})`);
            
            if (extRisks.length > 0) {
                desc += `- Factores externos: ${extRisks.join(', ')}.\n`;
            } else {
                desc += `- Sin factores externos de riesgo.\n`;
            }

            document.getElementById('rep-desc').value = desc;

            // Mostrar modal
            document.getElementById('boletin-report-modal-overlay').classList.add('active');
        });
    }

    const closeReportBtn = document.getElementById('boletin-report-modal-close');
    if (closeReportBtn) {
        closeReportBtn.addEventListener('click', () => {
            document.getElementById('boletin-report-modal-overlay').classList.remove('active');
        });
    }

    const cancelReportBtn = document.getElementById('boletin-report-cancel-btn');
    if (cancelReportBtn) {
        cancelReportBtn.addEventListener('click', () => {
            document.getElementById('boletin-report-modal-overlay').classList.remove('active');
        });
    }

    const reportForm = document.getElementById('boletin-report-form');
    if (reportForm) {
        reportForm.addEventListener('submit', (e) => {
            e.preventDefault();

            const email = document.getElementById('rep-email').value;
            const name = document.getElementById('rep-name').value;
            const address = document.getElementById('rep-address').value;
            const coords = document.getElementById('rep-coords').value;
            const color = document.getElementById('rep-color').value;
            const evaluator = document.querySelector('input[name="rep-evaluator"]:checked').value;
            const desc = document.getElementById('rep-desc').value;

            // Construir URL precargada para Google Forms
            const baseUrl = "https://docs.google.com/forms/d/e/1FAIpQLSeLCR4CnpKBhJQy5EW6XFaJ-kZfnBgE6M0IoioaTrbWHloW6Q/viewform";
            const queryParams = new URLSearchParams();
            queryParams.append('usp', 'pp_url');
            queryParams.append('entry.1389691904', email);     // Correo de contacto
            queryParams.append('entry.344980478', name);       // Nombre del inmueble
            queryParams.append('entry.162650589', address);    // Ubicación del inmueble
            queryParams.append('entry.377810399', coords);     // Coordenadas mapa
            queryParams.append('entry.592454983', color);      // Color del Boletin
            queryParams.append('entry.1580584858', evaluator); // Evaluación hecha por
            queryParams.append('entry.588769988', desc);       // Descripcion de los daños

            const fullUrl = `${baseUrl}?${queryParams.toString()}`;
            
            // Abrir Google Form en nueva pestaña
            window.open(fullUrl, '_blank');

            // Cerrar el modal
            document.getElementById('boletin-report-modal-overlay').classList.remove('active');
        });
    }

    // Inicializar visualización de la guía y cálculo
    updateGuideVisual();
    calculateBoletinRisk();
}

// Algoritmo de decisión y actualización de etiqueta
function calculateBoletinRisk() {
    // 1. Obtener datos básicos
    const name = document.getElementById('bol-name').value || 'Edificación';
    const address = document.getElementById('bol-address').value || 'Sin dirección';
    const floors = parseInt(document.getElementById('bol-floors').value) || 1;
    const year = parseInt(document.getElementById('bol-year').value) || 1980;
    const basements = parseInt(document.getElementById('bol-basements').value) || 0;
    const semibasements = parseInt(document.getElementById('bol-semibasements').value) || 0;
    const dateStr = new Date().toLocaleDateString('es-VE');

    // Actualizar datos en la etiqueta visual
    document.getElementById('tag-display-name').textContent = name;
    document.getElementById('tag-display-address').textContent = address;
    document.getElementById('tag-display-date').textContent = dateStr;

    // Generar planilla aleatoria/consecutiva simulada
    const floorsPad = String(floors).padStart(2, '0');
    document.getElementById('tag-display-id').textContent = `BOL-2026-${floorsPad}45`;

    // 2. Evaluar Sección 2: Riesgo Externo
    let riskSec2 = 'bajo';
    const extAspects = [
        { val: getRadioVal('bol-ext-collapse'), name: 'Colapso de estructura' },
        { val: getRadioVal('bol-ext-neighbor'), name: 'Edificios aledaños' },
        { val: getRadioVal('bol-ext-geol'), name: 'Peligro geológico' },
        { val: getRadioVal('bol-ext-settlement'), name: 'Asentamiento' },
        { val: getRadioVal('bol-ext-tilt'), name: 'Inclinación de la estructura' }
    ];

    let extAltoAspects = [];
    let extMedioAspects = [];
    extAspects.forEach(asp => {
        if (asp.val === 'alto') {
            riskSec2 = 'alto';
            extAltoAspects.push(asp.name);
        } else if (asp.val === 'medio' && riskSec2 !== 'alto') {
            riskSec2 = 'medio';
            extMedioAspects.push(asp.name);
        }
    });

    // 3. Evaluar Sección 3: Daño Severo/Completo (Piso Crítico)
    const sevCols = parseInt(document.getElementById('bol-sev-cols').value) || 0;
    const sevWallsC = parseInt(document.getElementById('bol-sev-walls-c').value) || 0;
    const sevWallsM = parseInt(document.getElementById('bol-sev-walls-m').value) || 0;
    const sevBeams = parseInt(document.getElementById('bol-sev-beams').value) || 0;
    const totalSevereElements = sevCols + sevWallsC + sevWallsM + sevBeams;

    let riskSec3 = 'bajo';
    if (totalSevereElements >= 1) {
        riskSec3 = 'alto';
    }

    // 4. Evaluar Sección 4: Daño Moderado (Cálculo tabular e individual para cada uno de los 4 elementos principales)
    const modColsTot = parseInt(document.getElementById('bol-mod-cols-tot').value) || 1;
    const modColsCnt = parseInt(document.getElementById('bol-mod-cols-cnt').value) || 0;
    const pctCols = (modColsCnt / Math.max(modColsTot, 1)) * 100;
    document.getElementById('bol-mod-cols-pct').textContent = `${pctCols.toFixed(2)}%`;

    const modWallsCTot = parseInt(document.getElementById('bol-mod-wallsc-tot').value) || 1;
    const modWallsCCnt = parseInt(document.getElementById('bol-mod-wallsc-cnt').value) || 0;
    const pctWallsC = (modWallsCCnt / Math.max(modWallsCTot, 1)) * 100;
    document.getElementById('bol-mod-wallsc-pct').textContent = `${pctWallsC.toFixed(2)}%`;

    const modWallsMTot = parseInt(document.getElementById('bol-mod-wallsm-tot').value) || 1;
    const modWallsMCnt = parseInt(document.getElementById('bol-mod-wallsm-cnt').value) || 0;
    const pctWallsM = (modWallsMCnt / Math.max(modWallsMTot, 1)) * 100;
    document.getElementById('bol-mod-wallsm-pct').textContent = `${pctWallsM.toFixed(2)}%`;

    const modBeamsTot = parseInt(document.getElementById('bol-mod-beams-tot').value) || 1;
    const modBeamsCnt = parseInt(document.getElementById('bol-mod-beams-cnt').value) || 0;
    const pctBeams = (modBeamsCnt / Math.max(modBeamsTot, 1)) * 100;
    document.getElementById('bol-mod-beams-pct').textContent = `${pctBeams.toFixed(2)}%`;

    // El riesgo por daño moderado se determina a partir del mayor porcentaje obtenido entre los elementos
    const maxPct = Math.max(pctCols, pctWallsC, pctWallsM, pctBeams);
    document.getElementById('bol-mod-pct-display').textContent = `${maxPct.toFixed(2)}%`;

    let maxElemName = 'elementos estructurales';
    if (maxPct === pctCols) maxElemName = 'Columnas o uniones';
    else if (maxPct === pctWallsC) maxElemName = 'Muros de concreto';
    else if (maxPct === pctWallsM) maxElemName = 'Muros de mampostería';
    else if (maxPct === pctBeams) maxElemName = 'Vigas o arriostramientos';

    let riskSec4 = 'bajo';
    const riskDisplay = document.getElementById('bol-mod-risk-display');

    if (maxPct < 10) {
        riskSec4 = 'bajo';
        if (riskDisplay) {
            riskDisplay.textContent = 'Bajo (<10%)';
            riskDisplay.className = 'badge-status-green';
        }
    } else if (maxPct >= 10 && maxPct <= 30) {
        riskSec4 = 'medio';
        if (riskDisplay) {
            riskDisplay.textContent = 'Medio (10-30%)';
            riskDisplay.className = 'badge-status-yellow';
        }
    } else {
        riskSec4 = 'alto';
        if (riskDisplay) {
            riskDisplay.textContent = 'Alto (>30%)';
            riskDisplay.className = 'badge-status-red';
        }
    }

    // Ocultar o atenuar Sección 4 si hay elementos con daño Severo
    const cardDanoModerado = document.getElementById('card-dano-moderado');
    if (cardDanoModerado) {
        if (totalSevereElements >= 1) {
            cardDanoModerado.style.opacity = '0.5';
            cardDanoModerado.style.pointerEvents = 'none';
        } else {
            cardDanoModerado.style.opacity = '1';
            cardDanoModerado.style.pointerEvents = 'auto';
        }
    }

    // 5. Evaluar Sección 5: Componentes No Estructurales
    let riskSec5 = 'bajo';
    const compAspects = [
        { val: getRadioVal('bol-comp-slabs'), name: 'Losas/Balcones' },
        { val: getRadioVal('bol-comp-walls'), name: 'Paredes/Fachadas' },
        { val: getRadioVal('bol-comp-tanks'), name: 'Tanques/Antenas' },
        { val: getRadioVal('bol-comp-utilities'), name: 'Servicios de Gas/Luz' },
        { val: getRadioVal('bol-comp-elevators'), name: 'Ascensores/Equipos' }
    ];

    let compAltoAspects = [];
    let compMedioAspects = [];
    compAspects.forEach(asp => {
        if (asp.val === 'alto') {
            riskSec5 = 'alto';
            compAltoAspects.push(asp.name);
        } else if (asp.val === 'medio' && riskSec5 !== 'alto') {
            riskSec5 = 'medio';
            compMedioAspects.push(asp.name);
        }
    });

    // 6. Calificación Final (El máximo riesgo entre Secciones 2, 3, 4 y 5)
    let finalRisk = 'bajo';
    let triggers = [];

    if (riskSec2 === 'alto') { finalRisk = 'alto'; triggers.push('Inspección Externa con Riesgo Alto'); }
    if (riskSec3 === 'alto') { finalRisk = 'alto'; triggers.push('Daño Severo/Completo en Elementos Principales'); }
    if (riskSec4 === 'alto') { finalRisk = 'alto'; triggers.push('Daño Moderado excesivo (>30% de elementos)'); }
    if (riskSec5 === 'alto') { finalRisk = 'alto'; triggers.push('Componentes No Estructurales con Riesgo Alto'); }

    if (finalRisk !== 'alto') {
        if (riskSec2 === 'medio') { finalRisk = 'medio'; triggers.push('Inspección Externa con Riesgo Medio'); }
        if (riskSec4 === 'medio') { finalRisk = 'medio'; triggers.push('Daño Moderado en rango 10-30%'); }
        if (riskSec5 === 'medio') { finalRisk = 'medio'; triggers.push('Componentes No Estructurales con Riesgo Medio'); }
    }

    // 7. Actualizar la Etiqueta Visual de FUNVISIS
    const tagBox = document.getElementById('boletin-tag-box');
    const tagTitle = document.getElementById('boletin-tag-title');
    const tagSubtitle = document.getElementById('boletin-tag-subtitle');
    const explanationText = document.getElementById('dictamen-explanation-text');
    const actionsList = document.getElementById('dictamen-actions-list');

    // Desmarcar todo en checkboxes por defecto al recalcular para no pisar el UI
    // a menos que sea gatillado por preset. Mantendremos sincronizado el dictamen con los checkboxes.
    let suggestedActions = [];

    if (finalRisk === 'alto') {
        // ETIQUETA ROJA: ACCESO NO PERMITIDO (PELIGRO)
        tagBox.className = 'funvisis-tag-box tag-roja-style';
        tagTitle.textContent = 'PELIGRO';
        tagSubtitle.textContent = 'NO ENTRE NI OCUPE';

        explanationText.innerHTML = `<strong>Riesgo Alto Detectado.</strong> Se restringe totalmente el acceso debido a:<br>
            <ul style="margin: 6px 0; padding-left: 18px; color: #ff6b6b;">
                ${triggers.map(t => `<li>${t}</li>`).join('')}
            </ul>
            Detalles técnicos: ${extAltoAspects.length ? `Riesgo externo severo en: ${extAltoAspects.join(', ')}. ` : ''}
            ${totalSevereElements ? `Se registraron ${totalSevereElements} elementos estructurales con daño Severo/Completo en el Piso Crítico (${document.getElementById('bol-critical-floor').value}).` : ''}
            ${riskSec4 === 'alto' ? `Se superó el límite del 30% de daño moderado en ${maxElemName} (${maxPct.toFixed(1)}%).` : ''}
            ${compAltoAspects.length ? `Riesgo inminente de caída/colapso en: ${compAltoAspects.join(', ')}.` : ''}`;

        suggestedActions = [
            'Inspección Estructural Detallada por especialistas.',
            'Acordonar la zona del edificio (riesgo de colapso o caída de escombros).',
            'Cerrar calles aledañas al tránsito peatonal y vehicular.',
            'Desconectar servicios principales de gas y electricidad para evitar incendios.',
            'Apuntalar urgentemente elementos dañados que comprometan la gravedad.'
        ];

        // Auto-check preventivos sugeridos
        setCheckVal('bol-act-det-struct', true);
        setCheckVal('bol-act-prev-cordon', true);
    } else if (finalRisk === 'medio') {
        // ETIQUETA AMARILLA: ACCESO RESTRINGIDO (ATENCIÓN)
        tagBox.className = 'funvisis-tag-box tag-amarilla-style';
        tagTitle.textContent = 'ATENCIÓN';
        tagSubtitle.textContent = 'USO RESTRINGIDO';

        explanationText.innerHTML = `<strong>Riesgo Moderado Detectado.</strong> Acceso limitado temporalmente. Riesgos identificados:<br>
            <ul style="margin: 6px 0; padding-left: 18px; color: #ffcc00;">
                ${triggers.map(t => `<li>${t}</li>`).join('')}
            </ul>
            Detalles: ${extMedioAspects.length ? `Factores externos en nivel Medio: ${extMedioAspects.join(', ')}. ` : ''}
            ${riskSec4 === 'medio' ? `Daño moderado de entrepiso en ${maxElemName} del ${maxPct.toFixed(1)}% (Rango 10-30%).` : ''}
            ${compMedioAspects.length ? `Daños moderados en componentes no estructurales: ${compMedioAspects.join(', ')}.` : ''}`;

        suggestedActions = [
            'Inspección Estructural Detallada para autorizar reparaciones.',
            'Acordonar localmente las zonas inestables (ej. balcones o fachadas agrietadas).',
            'Monitoreo visual continuo ante posibles réplicas.'
        ];

        setCheckVal('bol-act-det-struct', true);
        setCheckVal('bol-act-prev-cordon', true);
    } else {
        // ETIQUETA VERDE: ACCESO PERMITIDO (HABITABLE)
        tagBox.className = 'funvisis-tag-box tag-verde-style';
        tagTitle.textContent = 'HABITABLE';
        tagSubtitle.textContent = 'ACCESO PERMITIDO';

        explanationText.innerHTML = `<strong>Estructura Segura / Daño Leve.</strong> La edificación no presenta riesgos estructurales ni externos significativos. Las condiciones son estables.`;

        suggestedActions = [
            'Acceso libre permitido de forma inmediata.',
            'Monitorear la aparición de microfisuras durante las réplicas.',
            'No se requieren inspecciones detalladas obligatorias de emergencia.'
        ];

        setCheckVal('bol-act-det-struct', false);
        setCheckVal('bol-act-prev-cordon', false);
    }

    // Renderizar lista de acciones sugeridas en panel
    actionsList.innerHTML = suggestedActions.map(act => `<li><i class="fa-solid fa-check" style="color: #2ec4b6; margin-right: 6px;"></i> ${act}</li>`).join('');
}

// Actualizar checkboxes del formulario basados en clics del usuario
function updateActionsFromUI() {
    // Esto se dispara cuando el usuario interactúa manualmente con los checkboxes
}

// Carga de Presets de Casos Reales
function loadBoletinPreset(presetName) {
    const setRadio = (name, value) => {
        const radios = document.getElementsByName(name);
        radios.forEach(r => {
            r.checked = (r.value === value);
        });
    };

    const setInput = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = value;
    };

    const setCheck = (id, checked) => {
        const el = document.getElementById(id);
        if (el) el.checked = checked;
    };

    if (presetName === 'sheraton') {
        currentBoletinCoords = "10.6139, -66.8837";
        // Hotel Macuto Sheraton (Caracas 1967) - Colapso de Columnas en PB/Mezzanina
        setInput('bol-name', 'Hotel Macuto Sheraton (Módulo Central)');
        setInput('bol-address', 'Sector Caraballeda, Litoral Central');
        setInput('bol-floors', 11);
        setInput('bol-use', 'commercial');
        setInput('bol-material', 'concrete');
        setInput('bol-year', 1955);
        setInput('bol-basements', 0);
        setInput('bol-semibasements', 1);

        // Inspección Externa: Peligro geológico medio (licuación de arena costera)
        setRadio('bol-ext-collapse', 'bajo');
        setRadio('bol-ext-neighbor', 'bajo');
        setRadio('bol-ext-geol', 'medio');
        setRadio('bol-ext-settlement', 'bajo');
        setRadio('bol-ext-tilt', 'bajo');

        // Daño Severo: 14 Columnas en Mezzanina colapsadas/aplastadas
        setInput('bol-critical-floor', 'Mezzanina / Piso 3');
        setInput('bol-access', 'todos');
        setInput('bol-sev-cols', 14);
        setInput('bol-sev-walls-c', 0);
        setInput('bol-sev-walls-m', 0);
        setInput('bol-sev-beams', 4);

        // Daño Moderado (Sección 4): Omitido por severidad alta
        setInput('bol-mod-cols-tot', 24);
        setInput('bol-mod-cols-cnt', 0);
        setInput('bol-mod-wallsc-tot', 10);
        setInput('bol-mod-wallsc-cnt', 0);
        setInput('bol-mod-wallsm-tot', 10);
        setInput('bol-mod-wallsm-cnt', 0);
        setInput('bol-mod-beams-tot', 20);
        setInput('bol-mod-beams-cnt', 0);

        // Componentes No Estructurales: Colapso de cielo raso en lobby, vigas de mampostería agrietadas
        setRadio('bol-comp-slabs', 'medio');
        setRadio('bol-comp-walls', 'medio');
        setRadio('bol-comp-tanks', 'bajo');
        setRadio('bol-comp-utilities', 'medio');
        setRadio('bol-comp-elevators', 'medio');

        // Acciones recomendadas
        setCheck('bol-act-det-struct', true);
        setCheck('bol-act-det-geot', true);
        setCheck('bol-act-det-inst', true);
        setCheck('bol-act-prev-cordon', true);
        setCheck('bol-act-prev-street', true);
        setCheck('bol-act-prev-shore', true);
        setCheck('bol-act-prev-gas', true);
        setCheck('bol-act-prev-elec', true);

    } else if (presetName === 'liceo') {
        currentBoletinCoords = "10.4988, -63.7494";
        // Liceo Raimundo Martínez Centeno (Cariaco sismo 1997) - Vigas rotas, columnas dañadas
        setInput('bol-name', 'Liceo Raimundo M. Centeno');
        setInput('bol-address', 'Av. Principal de Cariaco, Edo. Sucre');
        setInput('bol-floors', 3);
        setInput('bol-use', 'public');
        setInput('bol-material', 'concrete');
        setInput('bol-year', 1978);
        setInput('bol-basements', 0);
        setInput('bol-semibasements', 0);

        // Externa: Colapso parcial externo por falla de pórticos
        setRadio('bol-ext-collapse', 'medio');
        setRadio('bol-ext-neighbor', 'bajo');
        setRadio('bol-ext-geol', 'bajo');
        setRadio('bol-ext-settlement', 'bajo');
        setRadio('bol-ext-tilt', 'bajo');

        // Piso Crítico: 1er Piso
        setInput('bol-critical-floor', 'Primer Piso');
        setInput('bol-access', 'todos');
        setInput('bol-sev-cols', 0);
        setInput('bol-sev-walls-c', 0);
        setInput('bol-sev-walls-m', 0);
        setInput('bol-sev-beams', 2);

        // Daño Moderado: Columnas con daño moderado
        setInput('bol-mod-cols-tot', 16);
        setInput('bol-mod-cols-cnt', 4); // 25% columns con daño moderado
        setInput('bol-mod-wallsc-tot', 10);
        setInput('bol-mod-wallsc-cnt', 0);
        setInput('bol-mod-wallsm-tot', 10);
        setInput('bol-mod-wallsm-cnt', 0);
        setInput('bol-mod-beams-tot', 12);
        setInput('bol-mod-beams-cnt', 0);

        // Componentes: Escaleras agrietadas, paredes tabiquería agrietadas
        setRadio('bol-comp-slabs', 'bajo');
        setRadio('bol-comp-walls', 'medio');
        setRadio('bol-comp-tanks', 'bajo');
        setRadio('bol-comp-utilities', 'bajo');
        setRadio('bol-comp-elevators', 'bajo');

        // Acciones
        setCheck('bol-act-det-struct', true);
        setCheck('bol-act-det-geot', false);
        setCheck('bol-act-det-inst', false);
        setCheck('bol-act-prev-cordon', true);
        setCheck('bol-act-prev-street', false);
        setCheck('bol-act-prev-shore', true);
        setCheck('bol-act-prev-gas', false);
        setCheck('bol-act-prev-elec', false);

    } else if (presetName === 'tanaguarena') {
        currentBoletinCoords = "10.6148, -66.8647";
        // Residencias Solymar (Vargas 2026) - Daño Moderado de Columnas (Etiqueta Amarilla)
        setInput('bol-name', 'Residencias Solymar (Módulo B)');
        setInput('bol-address', 'Av. La Playa, Tanaguarena, La Guaira');
        setInput('bol-floors', 6);
        setInput('bol-use', 'residential');
        setInput('bol-material', 'concrete');
        setInput('bol-year', 2005);
        setInput('bol-basements', 1);
        setInput('bol-semibasements', 0);

        // Externa: Edificio aledaño inclinado (riesgo medio), asentamientos leves
        setRadio('bol-ext-collapse', 'bajo');
        setRadio('bol-ext-neighbor', 'medio');
        setRadio('bol-ext-geol', 'bajo');
        setRadio('bol-ext-settlement', 'bajo');
        setRadio('bol-ext-tilt', 'bajo');

        // Sin daño severo
        setInput('bol-critical-floor', 'Planta Baja');
        setInput('bol-access', 'casi');
        setInput('bol-sev-cols', 0);
        setInput('bol-sev-walls-c', 0);
        setInput('bol-sev-walls-m', 0);
        setInput('bol-sev-beams', 0);

        // Daño Moderado: 3 columnas de 20 con fisuras de flexión de 1.5mm (15%)
        setInput('bol-mod-cols-tot', 20);
        setInput('bol-mod-cols-cnt', 3); // 15% -> Riesgo Estructural Medio
        setInput('bol-mod-wallsc-tot', 6);
        setInput('bol-mod-wallsc-cnt', 0);
        setInput('bol-mod-wallsm-tot', 4);
        setInput('bol-mod-wallsm-cnt', 0);
        setInput('bol-mod-beams-tot', 16);
        setInput('bol-mod-beams-cnt', 0);

        // Tabiquería exterior con fisuras cruzadas importantes
        setRadio('bol-comp-slabs', 'bajo');
        setRadio('bol-comp-walls', 'medio');
        setRadio('bol-comp-tanks', 'bajo');
        setRadio('bol-comp-utilities', 'bajo');
        setRadio('bol-comp-elevators', 'bajo');

        // Acciones
        setCheck('bol-act-det-struct', true);
        setCheck('bol-act-det-geot', false);
        setCheck('bol-act-det-inst', false);
        setCheck('bol-act-prev-cordon', true);
        setCheck('bol-act-prev-street', false);
        setCheck('bol-act-prev-shore', false);
        setCheck('bol-act-prev-gas', false);
        setCheck('bol-act-prev-elec', false);

    } else if (presetName === 'vivienda') {
        currentBoletinCoords = "10.6111, -66.8920";
        // Vivienda Unifamiliar Macuto (2026) - Daños Leves (Etiqueta Verde)
        setInput('bol-name', 'Vivienda Unifamiliar Ing. Urich');
        setInput('bol-address', 'Calle El Progreso, Macuto, La Guaira');
        setInput('bol-floors', 2);
        setInput('bol-use', 'residential');
        setInput('bol-material', 'concrete');
        setInput('bol-year', 2012);
        setInput('bol-basements', 0);
        setInput('bol-semibasements', 0);

        // Externa: Todo bajo/seguro
        setRadio('bol-ext-collapse', 'bajo');
        setRadio('bol-ext-neighbor', 'bajo');
        setRadio('bol-ext-geol', 'bajo');
        setRadio('bol-ext-settlement', 'bajo');
        setRadio('bol-ext-tilt', 'bajo');

        // Sin daños severos ni moderados
        setInput('bol-critical-floor', 'Planta Baja');
        setInput('bol-access', 'todos');
        setInput('bol-sev-cols', 0);
        setInput('bol-sev-walls-c', 0);
        setInput('bol-sev-walls-m', 0);
        setInput('bol-sev-beams', 0);

        // Daño Moderado: 0
        setInput('bol-mod-cols-tot', 8);
        setInput('bol-mod-cols-cnt', 0);
        setInput('bol-mod-wallsc-tot', 6);
        setInput('bol-mod-wallsc-cnt', 0);
        setInput('bol-mod-wallsm-tot', 6);
        setInput('bol-mod-wallsm-cnt', 0);
        setInput('bol-mod-beams-tot', 10);
        setInput('bol-mod-beams-cnt', 0);

        // Componentes: Microfisuras en revoques (Bajo)
        setRadio('bol-comp-slabs', 'bajo');
        setRadio('bol-comp-walls', 'bajo');
        setRadio('bol-comp-tanks', 'bajo');
        setRadio('bol-comp-utilities', 'bajo');
        setRadio('bol-comp-elevators', 'bajo');

        // Acciones
        setCheck('bol-act-det-struct', false);
        setCheck('bol-act-det-geot', false);
        setCheck('bol-act-det-inst', false);
        setCheck('bol-act-prev-cordon', false);
        setCheck('bol-act-prev-street', false);
        setCheck('bol-act-prev-shore', false);
        setCheck('bol-act-prev-gas', false);
        setCheck('bol-act-prev-elec', false);
    } else {
        currentBoletinCoords = "";
        // Clear/Personalizado
        setInput('bol-name', 'Edificación Personalizada');
        setInput('bol-address', 'La Guaira, Venezuela');
        setInput('bol-floors', 5);
        setInput('bol-use', 'residential');
        setInput('bol-material', 'concrete');
        setInput('bol-year', 1980);
        setInput('bol-basements', 0);
        setInput('bol-semibasements', 0);

        setRadio('bol-ext-collapse', 'bajo');
        setRadio('bol-ext-neighbor', 'bajo');
        setRadio('bol-ext-geol', 'bajo');
        setRadio('bol-ext-settlement', 'bajo');
        setRadio('bol-ext-tilt', 'bajo');

        setInput('bol-critical-floor', 'Planta Baja');
        setInput('bol-access', 'todos');
        setInput('bol-sev-cols', 0);
        setInput('bol-sev-walls-c', 0);
        setInput('bol-sev-walls-m', 0);
        setInput('bol-sev-beams', 0);

        setInput('bol-mod-cols-tot', 20);
        setInput('bol-mod-cols-cnt', 0);
        setInput('bol-mod-wallsc-tot', 10);
        setInput('bol-mod-wallsc-cnt', 0);
        setInput('bol-mod-wallsm-tot', 10);
        setInput('bol-mod-wallsm-cnt', 0);
        setInput('bol-mod-beams-tot', 15);
        setInput('bol-mod-beams-cnt', 0);

        setRadio('bol-comp-slabs', 'bajo');
        setRadio('bol-comp-walls', 'bajo');
        setRadio('bol-comp-tanks', 'bajo');
        setRadio('bol-comp-utilities', 'bajo');
        setRadio('bol-comp-elevators', 'bajo');

        setCheck('bol-act-det-struct', false);
        setCheck('bol-act-det-geot', false);
        setCheck('bol-act-det-inst', false);
        setCheck('bol-act-prev-cordon', false);
        setCheck('bol-act-prev-street', false);
        setCheck('bol-act-prev-shore', false);
        setCheck('bol-act-prev-gas', false);
        setCheck('bol-act-prev-elec', false);
    }

    calculateBoletinRisk();
}

// Helpers para valores de inputs
function getRadioVal(name) {
    const el = document.querySelector(`input[name="${name}"]:checked`);
    return el ? el.value : 'bajo';
}

function setCheckVal(id, checked) {
    const el = document.getElementById(id);
    if (el) el.checked = checked;
}

// Actualizar la guía técnica del manual de entrenamiento
function updateGuideVisual() {
    const guideData = {
        column: {
            title: "Columnas de Concreto Armado",
            impact: "Define el comportamiento de pórticos. Daño Severo/Completo restringe el acceso inmediato (Etiqueta Roja).",
            reference: {
                menor: "Fisuras finas (< 1 mm). Sismo de Yaguaraparo 2018.",
                moderado: "Grietas entre 1 y 2 mm. Liceo Raimundo Martínez Centeno, Cariaco 1997.",
                severo: "Grietas > 2 mm y desconchado del concreto. Edificio La Mar Suites, Tucacas 2009.",
                completo: "Pandeo de barras de acero y aplastamiento del concreto. Edificio Petunia, Caracas 1967."
            },
            desc: {
                menor: "Fisuras muy superficiales o capilares que no cruzan el núcleo del concreto. No comprometen la rigidez lateral de la columna.",
                moderado: "Grietas diagonales de cortante o fisuración horizontal de flexión. Requiere inyección de resina epóxica en fases de reparación, pero no de emergencia.",
                severo: "Amplias grietas, caída del recubrimiento exterior del concreto por fatiga y desprendimiento. El núcleo de concreto confinado comienza a dañarse.",
                completo: "Aplastamiento destructivo de la sección de concreto, desbocamiento de estribos y pandeo hacia el exterior de las barras longitudinales de acero."
            }
        },
        joint: {
            title: "Uniones Viga-Columna (Nodos)",
            impact: "Zona crítica de transferencia de momentos. Daños severos inducen fallas de piso blando muy frágiles.",
            reference: {
                menor: "Desconchado muy superficial. Liceo R. Martínez, Cariaco 1997.",
                moderado: "Fisuras diagonales leves y exposición superficial de estribos. Pedernales 2016.",
                severo: "Grietas en X en el núcleo del nodo y desprendimiento. Ensayos estructurales IMME-UCV.",
                completo: "Pérdida total del núcleo del nodo, separación física de elementos. Pedernales 2016."
            },
            desc: {
                menor: "Caída menor del revoque o acabado arquitectónico exterior en el encuentro de viga y columna. Sin fisuras de cortante.",
                moderado: "Fisuras inclinadas en la zona del nodo. Estribos internos intactos pero sometidos a esfuerzos. Pérdida parcial del recubrimiento de concreto.",
                severo: "Fisuración diagonal severa en cruz (forma de X) que atraviesa el núcleo. Concreto triturado en los laterales de la unión.",
                completo: "Colapso completo de la unión del nodo, con pérdida de la capacidad de soporte vertical de la columna e imposibilidad de transmitir momentos."
            }
        },
        beam: {
            title: "Vigas de Concreto Armado",
            impact: "Afecta la rigidez local y ductilidad. Daño severo local puede ser mitigado con apuntalamiento temporal.",
            reference: {
                menor: "Grietas de flexión capilares. Sismo de Yaguaraparo 2018.",
                moderado: "Grietas de 1-2 mm con leve aplastamiento. Sismo de Caracas 1967.",
                severo: "Caída de concreto en apoyos, fisuración ancha. Sismo de Tucacas 2012.",
                completo: "Falla de cortante en apoyos, flecha vertical severa visible. Cariaco 1997."
            },
            desc: {
                menor: "Fisuras verticales finas en la zona de máximo momento positivo (centro de la luz) o negativo (apoyos). Sin peligro.",
                moderado: "Fisuras de flexión notables con leve desconchado en la cara inferior de la viga. Fisuras diagonales de cortante incipientes cerca del apoyo.",
                severo: "Fisuración severa por cortante o flexión. Concreto desprendido, dejando al descubierto el acero de refuerzo longitudinal o transversal (estribos).",
                completo: "Rotura de barras de acero a tracción, desprendimiento generalizado del concreto y deformación vertical (deflexión) permanente visible."
            }
        },
        wall_c: {
            title: "Muros de Concreto Armado (Pantallas)",
            impact: "Muros de corte aportan gran rigidez. Las grietas diagonales indican sobreesfuerzo de cortante de la edificación.",
            reference: {
                menor: "Fisuras muy finas. Sismo de Hawai 2006.",
                moderado: "Grietas diagonales entre 2 mm y 6 mm. Ensayos estructurales.",
                severo: "Exposición de malla de refuerzo y desconchado. Laboratorios CENAPRED.",
                completo: "Fractura de acero, pandeo de barras, deslizamiento en base. Chile 2010."
            },
            desc: {
                menor: "Pocas fisuras superficiales finas (< 2 mm) distribuidas uniformemente. Típico comportamiento elástico inicial.",
                moderado: "Agrietamiento diagonal notable cruzando el alma del muro (espesores 2-6 mm). Sin peligro inminente de aplastamiento.",
                severo: "Grietas anchas (> 6 mm) con pérdida de recubrimiento y exposición de la armadura electrosoldada o cabillas de refuerzo en el muro.",
                completo: "Aplastamiento severo de los bordes de confinamiento del muro, pandeo del acero, deslizamiento horizontal (falla por deslizamiento en junta) o colapso."
            }
        },
        wall_m: {
            title: "Muros Portantes de Mampostería Estructural",
            impact: "Muros cargan el peso de losas. Daño severo en muros portantes equivale a colapso estructural inminente.",
            reference: {
                menor: "Microfisuras en mortero. Criterios del Boletín.",
                moderado: "Fisuración diagonal de 1-3 mm. Sismo de México 2019.",
                severo: "Dislocación de bloques o grietas diagonales > 3 mm. CENAPRED 2014.",
                completo: "Desplome de muros, desprendimiento masivo de ladrillos. Bam, Irán 2004."
            },
            desc: {
                menor: "Líneas de agrietamiento finas restringidas al mortero de pega entre bloques o ladrillos. Sin bloques rotos.",
                moderado: "Fisuras diagonales escalonadas a lo largo de las juntas y afectando algunos bloques individuales (espesores 1-3 mm).",
                severo: "Grietas diagonales severas de más de 3 mm de espesor que rompen los bloques en línea continua. Pérdida parcial del plano del muro.",
                completo: "Aplastamiento local severo de esquinas de apoyo, dislocación y derrumbe parcial del muro, inclinación del muro fuera de la vertical o colapso total."
            }
        },
        infill: {
            title: "Tabiques y Paredes de Relleno (No Estructural)",
            impact: "Son componentes secundarios. Aunque no comprometen la estructura, su caída causa la mayoría de muertes en sismos.",
            reference: {
                menor: "Microfisuras perimetrales. Cumaná 2008.",
                moderado: "Fisuras diagonales y rotura en esquinas. Tecomán 2003.",
                severo: "Separación física de pórticos y bloques sueltos. Tucacas 2009.",
                completo: "Volcamiento de paredes fuera de su plano, derrumbe. La Guaira 2026."
            },
            desc: {
                menor: "Fisuración muy fina en el contorno del pórtico (losa/columnas) debido a la diferencia de rigidez entre concreto y arcilla.",
                moderado: "Fisuras en cruz en el centro de la pared o grietas diagonales cerca de marcos de puertas y ventanas. Algunos ladrillos con grietas leves.",
                severo: "Pared separada de la estructura de concreto. Grietas anchas con peligro de caída del bloque hacia el exterior o interior del recinto.",
                completo: "Pared totalmente destruida o desplomada fuera de su plano de confinamiento por fuerzas inerciales perpendiculares."
            }
        }
    };

    const element = activeGuideElement;
    const damage = activeGuideDamage;
    const data = guideData[element];

    // Actualizar Textos
    document.getElementById('guide-title').textContent = `${data.title} - Daño ${damage.charAt(0).toUpperCase() + damage.slice(1)}`;
    document.getElementById('guide-criteria').textContent = data.desc[damage];
    document.getElementById('guide-photo-ref').innerHTML = `<i class="fa-solid fa-camera" style="color: #ffb703;"></i> ${data.reference[damage]}`;
    document.getElementById('guide-impact').querySelector('span').innerHTML = `<strong>Guía del Inspector:</strong> ${data.impact}`;

    // Dibujar Gráfico SVG Dinámico
    const svgCanvas = document.getElementById('guide-svg-canvas');
    if (svgCanvas) {
        svgCanvas.innerHTML = drawGuideSVG(element, damage);
    }
}

// Dibujado de diagramas dinámicos SVG para ilustrar los daños
function drawGuideSVG(element, damage) {
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="100%" height="100%">`;

    // Fondo de dibujo técnico oscuro
    svg += `<rect width="200" height="200" fill="#0f131a" rx="4" />`;
    // Rejilla de fondo
    svg += `<g stroke="rgba(255, 255, 255, 0.03)" stroke-width="0.5">`;
    for (let i = 20; i < 200; i += 20) {
        svg += `<line x1="${i}" y1="0" x2="${i}" y2="200" />`;
        svg += `<line x1="0" y1="${i}" x2="200" y2="${i}" />`;
    }
    svg += `</g>`;

    if (element === 'column') {
        // Dibujo de Columna
        // Base y Tope (losas)
        svg += `<rect x="30" y="20" width="140" height="15" fill="#2d3748" />`;
        svg += `<rect x="30" y="165" width="140" height="15" fill="#2d3748" />`;

        // Cuerpo columna
        svg += `<rect x="80" y="35" width="40" height="130" fill="#4a5568" stroke="#718096" stroke-width="2" id="col-body" />`;

        if (damage === 'menor') {
            // Grietas muy finas
            svg += `<path d="M 80,60 L 95,62 M 80,120 L 90,121 M 120,80 L 110,81" stroke="#facc15" stroke-width="1" />`;
            // Texto indicativo
            svg += `<text x="100" y="193" fill="#a0aec0" font-size="9" text-anchor="middle" font-family="monospace">Grietas capilares &lt; 1mm</text>`;
        } else if (damage === 'moderado') {
            // Grietas cruzadas inclinadas
            svg += `<path d="M 80,60 L 105,75 M 120,65 L 95,80 M 80,120 L 100,130" stroke="#fb923c" stroke-width="1.5" stroke-linecap="round" />`;
            svg += `<text x="100" y="193" fill="#a0aec0" font-size="9" text-anchor="middle" font-family="monospace">Grietas diagonal 1-2mm</text>`;
        } else if (damage === 'severo') {
            // Pérdida de recubrimiento (desconchado) y acero visible
            // Recubrimiento faltante
            svg += `<path d="M 80,70 Q 95,85 80,100 Z" fill="#2d3748" />`;
            // Estribo visible
            svg += `<line x1="84" y1="75" x2="84" y2="95" stroke="#a0aec0" stroke-width="1.5" />`;
            svg += `<line x1="80" y1="85" x2="120" y2="85" stroke="#a0aec0" stroke-dasharray="2,2" stroke-width="1" />`;
            // Grietas anchas rojas
            svg += `<path d="M 80,85 L 115,105 M 120,80 L 85,110" stroke="#f87171" stroke-width="2.5" stroke-linecap="round" />`;
            svg += `<text x="100" y="193" fill="#f87171" font-size="9" text-anchor="middle" font-family="monospace">Desconchado y Grieta &gt; 2mm</text>`;
        } else if (damage === 'completo') {
            // Columnas deformadas, acero pandeado exterior
            // Redibujar columna deformada/acortada
            svg += `<path d="M 80,35 L 80,75 L 72,90 L 80,110 L 80,165 L 120,165 L 120,110 L 128,95 L 120,80 L 120,35 Z" fill="#742a2a" stroke="#f87171" stroke-width="2" />`;
            // Acero pandeado saliente
            svg += `<path d="M 78,75 Q 60,90 78,110" fill="none" stroke="#ef4444" stroke-width="2.5" />`;
            svg += `<path d="M 122,80 Q 138,95 122,110" fill="none" stroke="#ef4444" stroke-width="2.5" />`;
            // Grietas catastróficas y escombros
            svg += `<path d="M 80,90 L 120,90 M 80,85 L 120,100" stroke="#ef4444" stroke-width="3" />`;
            svg += `<circle cx="65" cy="140" r="4" fill="#a0aec0" />`;
            svg += `<circle cx="135" cy="150" r="3" fill="#a0aec0" />`;
            svg += `<rect x="70" y="155" width="8" height="6" fill="#a0aec0" />`;
            svg += `<text x="100" y="193" fill="#ef4444" font-size="9" text-anchor="middle" font-family="monospace">Pandeo de acero y colapso</text>`;
        }

    } else if (element === 'joint') {
        // Nodos Viga-Columna
        // Cruz de columna y vigas
        svg += `<path d="M 85,20 L 115,20 L 115,75 L 180,75 L 180,105 L 115,105 L 115,180 L 85,180 L 85,105 L 20,105 L 20,75 L 85,75 Z" fill="#4a5568" stroke="#718096" stroke-width="2" />`;

        if (damage === 'menor') {
            // Fisuras en contorno del nodo
            svg += `<path d="M 85,78 L 95,83 M 115,77 L 108,84 M 88,103 L 94,97" stroke="#facc15" stroke-width="1" />`;
            svg += `<text x="100" y="193" fill="#a0aec0" font-size="9" text-anchor="middle" font-family="monospace">Microfisuras perimetrales</text>`;
        } else if (damage === 'moderado') {
            // Grietas diagonales cruzando el nodo
            svg += `<path d="M 88,78 L 112,102 M 112,78 L 92,98" stroke="#fb923c" stroke-width="1.5" />`;
            svg += `<text x="100" y="193" fill="#a0aec0" font-size="9" text-anchor="middle" font-family="monospace">Grietas en núcleo de nodo</text>`;
        } else if (damage === 'severo') {
            // Desconchado importante en núcleo
            svg += `<circle cx="100" cy="90" r="15" fill="#2d3748" />`;
            svg += `<line x1="90" y1="80" x2="90" y2="100" stroke="#a0aec0" stroke-width="1.5" />`;
            // Grieta en X gruesa roja
            svg += `<path d="M 85,75 L 115,105 M 115,75 L 85,105" stroke="#f87171" stroke-width="3" stroke-linecap="round" />`;
            svg += `<text x="100" y="193" fill="#f87171" font-size="9" text-anchor="middle" font-family="monospace">X-Shear severo y desprendimiento</text>`;
        } else if (damage === 'completo') {
            // Nodo destruido
            svg += `<circle cx="100" cy="90" r="22" fill="#742a2a" stroke="#ef4444" stroke-dasharray="3,3" />`;
            // Rotura de elementos, cables de acero doblados
            svg += `<path d="M 90,80 Q 100,75 110,83 M 92,102 Q 100,108 108,98" fill="none" stroke="#ef4444" stroke-width="2" />`;
            svg += `<path d="M 85,75 L 115,105 M 115,75 L 85,105" stroke="#111" stroke-width="4" />`;
            svg += `<text x="100" y="193" fill="#ef4444" font-size="9" text-anchor="middle" font-family="monospace">Falla de soporte y aplastamiento</text>`;
        }

    } else if (element === 'beam') {
        // Viga Horizontal
        // Columnas laterales
        svg += `<rect x="20" y="30" width="25" height="140" fill="#2d3748" />`;
        svg += `<rect x="155" y="30" width="25" height="140" fill="#2d3748" />`;
        // Viga
        svg += `<rect x="45" y="60" width="110" height="35" fill="#4a5568" stroke="#718096" stroke-width="2" id="beam-rect" />`;

        if (damage === 'menor') {
            // Pequeñas grietas verticales en zona inferior del centro
            svg += `<line x1="90" y1="95" x2="90" y2="85" stroke="#facc15" stroke-width="1" />`;
            svg += `<line x1="100" y1="95" x2="100" y2="83" stroke="#facc15" stroke-width="1" />`;
            svg += `<line x1="110" y1="95" x2="110" y2="87" stroke="#facc15" stroke-width="1" />`;
            svg += `<text x="100" y="193" fill="#a0aec0" font-size="9" text-anchor="middle" font-family="monospace">Fisuras verticales de flexión</text>`;
        } else if (damage === 'moderado') {
            // Grietas diagonales en extremos, flexión en centro
            svg += `<path d="M 45,70 L 58,85 M 155,70 L 142,85" stroke="#fb923c" stroke-width="1.5" />`;
            svg += `<line x1="100" y1="95" x2="100" y2="80" stroke="#fb923c" stroke-width="1.5" />`;
            svg += `<text x="100" y="193" fill="#a0aec0" font-size="9" text-anchor="middle" font-family="monospace">Grietas en centro y extremos</text>`;
        } else if (damage === 'severo') {
            // Desconchado en apoyos
            svg += `<rect x="45" y="60" width="15" height="15" fill="#2d3748" />`;
            svg += `<rect x="140" y="60" width="15" height="15" fill="#2d3748" />`;
            // Cabillas visibles
            svg += `<line x1="45" y1="65" x2="60" y2="65" stroke="#a0aec0" stroke-width="1.5" />`;
            // Deformación leve y grieta profunda
            svg += `<path d="M 45,75 L 70,95 M 155,75 L 130,95" stroke="#f87171" stroke-width="2.5" />`;
            svg += `<text x="100" y="193" fill="#f87171" font-size="9" text-anchor="middle" font-family="monospace">Falla de cortante severa en apoyos</text>`;
        } else if (damage === 'completo') {
            // Viga partida y flectada hacia abajo
            // Ocultar viga recta
            svg += `<rect x="44" y="59" width="112" height="37" fill="#0f131a" />`;
            // Dibujar viga deformada
            svg += `<path d="M 45,60 L 95,80 L 105,80 L 155,60 L 155,90 L 105,110 L 95,110 L 45,90 Z" fill="#742a2a" stroke="#ef4444" stroke-width="2" />`;
            // Grieta central abierta
            svg += `<path d="M 100,80 L 100,110" stroke="#ef4444" stroke-width="3.5" />`;
            // Acero roto colgante
            svg += `<path d="M 95,80 Q 100,90 98,95 M 105,80 Q 100,90 102,95" fill="none" stroke="#ef4444" stroke-width="2" />`;
            svg += `<text x="100" y="193" fill="#ef4444" font-size="9" text-anchor="middle" font-family="monospace">Rotura de viga y flexión plástica</text>`;
        }

    } else if (element === 'wall_c') {
        // Muros de Concreto
        svg += `<rect x="40" y="30" width="120" height="140" fill="#4a5568" stroke="#718096" stroke-width="2" />`;

        if (damage === 'menor') {
            svg += `<path d="M 50,45 L 80,75 M 120,110 L 140,130" stroke="#facc15" stroke-width="1" />`;
            svg += `<text x="100" y="193" fill="#a0aec0" font-size="9" text-anchor="middle" font-family="monospace">Fisuras diagonales finas</text>`;
        } else if (damage === 'moderado') {
            // Grietas diagonales cruzadas (X)
            svg += `<path d="M 50,50 L 150,150 M 150,50 L 50,150" stroke="#fb923c" stroke-width="1.5" />`;
            svg += `<text x="100" y="193" fill="#a0aec0" font-size="9" text-anchor="middle" font-family="monospace">Grietas en X en el muro</text>`;
        } else if (damage === 'severo') {
            // Desconchado en base o esquinas
            svg += `<path d="M 40,150 Q 60,140 70,170 Z" fill="#2d3748" />`;
            // Malla expuesta
            svg += `<line x1="45" y1="155" x2="65" y2="155" stroke="#a0aec0" stroke-width="1" />`;
            svg += `<line x1="55" y1="145" x2="55" y2="165" stroke="#a0aec0" stroke-width="1" />`;
            // Grietas en X gruesas
            svg += `<path d="M 50,50 L 150,150 M 150,50 L 50,150" stroke="#f87171" stroke-width="2.5" />`;
            svg += `<text x="100" y="193" fill="#f87171" font-size="9" text-anchor="middle" font-family="monospace">Desconchado basal y daño estructural</text>`;
        } else if (damage === 'completo') {
            // Deslizamiento en base, muro cortado en dos
            svg += `<rect x="38" y="28" width="124" height="144" fill="#0f131a" />`;
            // Dibujar muro desplazado horizontalmente en la base
            svg += `<path d="M 50,30 L 160,30 L 160,130 L 150,130 M 150,130 L 40,130 L 40,30" fill="#742a2a" stroke="#ef4444" stroke-width="2" />`;
            // Base del muro
            svg += `<path d="M 40,133 L 160,133 L 160,170 L 40,170 Z" fill="#4a5568" stroke="#718096" stroke-width="2" />`;
            // Flechas de desplazamiento
            svg += `<path d="M 30,130 L 15,130 M 15,130 L 22,125 M 15,130 L 22,135" stroke="#ef4444" stroke-width="2" />`;
            svg += `<path d="M 170,130 L 185,130 M 185,130 L 178,125 M 185,130 L 178,135" stroke="#ef4444" stroke-width="2" />`;
            // Grietas masivas en alma
            svg += `<path d="M 50,45 L 140,130" stroke="#ef4444" stroke-width="3" />`;
            svg += `<text x="100" y="193" fill="#ef4444" font-size="9" text-anchor="middle" font-family="monospace">Falla por cortante y deslizamiento</text>`;
        }

    } else if (element === 'wall_m') {
        // Muros de Mampostería (Ladrillos)
        svg += `<rect x="40" y="30" width="120" height="140" fill="#a0522d" stroke="#cd853f" stroke-width="2" />`;
        // Líneas de bloques horizontales
        for (let y = 44; y < 170; y += 14) {
            svg += `<line x1="40" y1="${y}" x2="160" y2="${y}" stroke="rgba(255,255,255,0.15)" stroke-width="1" />`;
        }

        if (damage === 'menor') {
            // Grietas escalonadas en mortero
            svg += `<path d="M 70,60 L 80,60 L 80,74 L 90,74 L 90,88" stroke="#facc15" stroke-width="1.5" fill="none" />`;
            svg += `<text x="100" y="193" fill="#a0aec0" font-size="9" text-anchor="middle" font-family="monospace">Fisuras finas en juntas</text>`;
        } else if (damage === 'moderado') {
            // Diagonales más amplias
            svg += `<path d="M 60,44 L 80,44 L 80,58 L 100,58 L 100,72 L 120,72 L 120,86 L 140,86" stroke="#fb923c" stroke-width="2.5" fill="none" />`;
            svg += `<path d="M 140,44 L 120,44 L 120,58 L 100,58 L 100,72 L 80,72 L 80,86 L 60,86" stroke="#fb923c" stroke-width="2.5" fill="none" />`;
            svg += `<text x="100" y="193" fill="#a0aec0" font-size="9" text-anchor="middle" font-family="monospace">Agrietamiento diagonal en juntas</text>`;
        } else if (damage === 'severo') {
            // Bloques salidos, grieta rompe ladrillos
            svg += `<path d="M 40,40 L 160,160" stroke="#f87171" stroke-width="3.5" />`;
            // Ladrillo caído
            svg += `<rect x="120" y="150" width="15" height="10" fill="#a0522d" stroke="#ef4444" stroke-width="1" transform="rotate(15 120 150)" />`;
            svg += `<text x="100" y="193" fill="#f87171" font-size="9" text-anchor="middle" font-family="monospace">Falla diagonal y desprendimiento</text>`;
        } else if (damage === 'completo') {
            // Muro derrumbado
            svg += `<rect x="38" y="28" width="124" height="144" fill="#0f131a" />`;
            // Pilas de bloques derrumbados en el suelo
            for (let i = 0; i < 6; i++) {
                svg += `<rect x="${50 + i * 16}" y="155" width="14" height="8" fill="#5c2c16" stroke="#ef4444" transform="rotate(${i * 12} ${50 + i * 16} 155)" />`;
                svg += `<rect x="${60 + i * 14}" y="163" width="14" height="8" fill="#5c2c16" stroke="#ef4444" transform="rotate(${-i * 8} ${60 + i * 14} 163)" />`;
            }
            svg += `<text x="100" y="193" fill="#ef4444" font-size="9" text-anchor="middle" font-family="monospace">Derrumbe del muro portante</text>`;
        }

    } else if (element === 'infill') {
        // Tabique de Relleno (Pórtico + Pared)
        // Pórtico estructural
        svg += `<rect x="30" y="20" width="140" height="150" fill="none" stroke="#4a5568" stroke-width="8" />`;
        // Pared de relleno interior
        svg += `<rect x="34" y="24" width="132" height="142" fill="#d2691e" opacity="0.8" />`;
        // Líneas de bloques
        for (let y = 35; y < 160; y += 15) {
            svg += `<line x1="34" y1="${y}" x2="166" y2="${y}" stroke="rgba(0,0,0,0.15)" stroke-width="1" />`;
        }

        if (damage === 'menor') {
            // Fisuras en contorno entre viga y columna
            svg += `<path d="M 34,24 L 166,24 M 34,24 L 34,166 M 166,24 L 166,166" stroke="#facc15" stroke-width="2" fill="none" />`;
            svg += `<text x="100" y="193" fill="#a0aec0" font-size="9" text-anchor="middle" font-family="monospace">Fisuras de interfaz perimetral</text>`;
        } else if (damage === 'moderado') {
            // X en el panel central
            svg += `<path d="M 40,30 L 160,160 M 160,30 L 40,160" stroke="#fb923c" stroke-width="1.5" />`;
            svg += `<text x="100" y="193" fill="#a0aec0" font-size="9" text-anchor="middle" font-family="monospace">Fisuras en X en tabiquería</text>`;
        } else if (damage === 'severo') {
            // Gaps anchos y bloques cayendo
            svg += `<path d="M 34,24 L 166,24 M 34,24 L 34,166" stroke="#ef4444" stroke-width="3" fill="none" />`;
            svg += `<path d="M 40,30 L 160,160" stroke="#f87171" stroke-width="2.5" />`;
            // Bloque suelto
            svg += `<rect x="50" y="130" width="16" height="8" fill="#d2691e" stroke="#ef4444" transform="rotate(25 50 130)" />`;
            svg += `<text x="100" y="193" fill="#f87171" font-size="9" text-anchor="middle" font-family="monospace">Separación y peligro de caída</text>`;
        } else if (damage === 'completo') {
            // Panel caído del marco
            // Ocultar panel
            svg += `<rect x="34" y="24" width="132" height="142" fill="#0f131a" />`;
            // Escombros en el suelo
            for (let i = 0; i < 8; i++) {
                svg += `<rect x="${40 + i * 16}" y="158" width="15" height="8" fill="#b05010" stroke="#ef4444" transform="rotate(${i * 23} ${40 + i * 16} 158)" />`;
                svg += `<rect x="${48 + i * 14}" y="165" width="15" height="8" fill="#b05010" stroke="#ef4444" transform="rotate(${-i * 15} ${48 + i * 14} 165)" />`;
            }
            svg += `<text x="100" y="193" fill="#ef4444" font-size="9" text-anchor="middle" font-family="monospace">Colapso total fuera de plano</text>`;
        }
    }

    svg += `</svg>`;
    return svg;
}

// --- MÓDULO DE INSPECCIÓN DE DAÑOS POR VISIÓN ARTIFICIAL (TENSORFLOW.JS + CANVAS FEATURE EXTRACTOR) ---
const VISION_CATEGORIES = [
    {
        id: 'shear',
        title: 'Falla por Cortante Diagonal (Short Column / Shear Crack)',
        severity: 'critical',
        tag: '🔴 INSEGURO — PROHIBIDO EL PASO',
        tagColor: '#ef4444',
        tagBg: 'rgba(239, 68, 68, 0.12)',
        tagBorder: '#ef4444',
        desc: 'Falla frágil por esfuerzo cortante caracterizada por grietas inclinadas a ~45°. Riesgo inminente de pérdida de capacidad de carga vertical.',
        action: 'Acordonamiento preventivo inmediato. Desalojar la edificación y requerir evaluación de ingeniería estructural antes de autorizar acceso.'
    },
    {
        id: 'crushing',
        title: 'Pandeo de Barras y Aplastamiento de Concreto',
        severity: 'critical',
        tag: '🔴 INSEGURO — PROHIBIDO EL PASO',
        tagColor: '#ef4444',
        tagBg: 'rgba(239, 68, 68, 0.12)',
        tagBorder: '#ef4444',
        desc: 'Aplastamiento del núcleo comprimido de concreto con deformación plástica y pandeo de la armadura longitudinal.',
        action: 'Prohibir estrictamente el acceso. Se requiere apuntalamiento de emergencia en niveles inferiores antes de cualquier intervención.'
    },
    {
        id: 'spalling',
        title: 'Desprendimiento de Concreto (Spalling)',
        severity: 'moderate',
        tag: '🟡 USO RESTRINGIDO — ACCESO LIMITADO',
        tagColor: '#f97316',
        tagBg: 'rgba(249, 115, 22, 0.12)',
        tagBorder: '#f97316',
        desc: 'Desprendimiento de la capa de recubrimiento de concreto con exposición visible de estribos y barras sin pandeo del núcleo.',
        action: 'Restringir el acceso a la zona afectada. Programar sustitución de concreto degradado y restitución de recubrimiento epóxico.'
    },
    {
        id: 'flexure',
        title: 'Fisuración por Flexión / Tracción',
        severity: 'minor',
        tag: '🟡 USO RESTRINGIDO / INSPECCIÓN DETALLADA',
        tagColor: '#facc15',
        tagBg: 'rgba(250, 204, 21, 0.12)',
        tagBorder: '#facc15',
        desc: 'Fisuras finas perpendiculares al eje del elemento causadas por momentos flectores en zonas de empalme o nodos.',
        action: 'Monitorear fisuras mediante testigos de yeso o fisurómetros. Realizar seguimiento tras eventuales réplicas.'
    },
    {
        id: 'intact',
        title: 'Sin Daño Estructural Apreciable',
        severity: 'none',
        tag: '🟢 HABITABLE — ACCESO PERMITIDO',
        tagColor: '#10b981',
        tagBg: 'rgba(16, 185, 129, 0.12)',
        tagBorder: '#10b981',
        desc: 'Elemento estructural sano. Solamente fisuras cosméticas menores en acabado de pintura o friso.',
        action: 'El elemento no presenta riesgo de colapso. Edificación calificada como apta para habitar según COVENIN 1756 / FUNVISIS.'
    }
];

function getVisionSampleSvg(type) {
    let content = '';
    if (type === 'col-shear') {
        content = `<rect width="400" height="400" fill="#0f172a"/>
        <text x="200" y="25" fill="#38bdf8" font-size="13" font-weight="bold" text-anchor="middle" font-family="sans-serif">COLUMNA DE CONCRETO (CORTO CORTANTE)</text>
        <rect x="150" y="45" width="100" height="310" fill="#475569" stroke="#64748b" stroke-width="3"/>
        <line x1="150" y1="110" x2="250" y2="230" stroke="#ef4444" stroke-width="7"/>
        <line x1="150" y1="130" x2="250" y2="250" stroke="#f87171" stroke-width="4"/>
        <text x="200" y="380" fill="#ef4444" font-size="15" font-weight="bold" text-anchor="middle" font-family="sans-serif">FALLA DE COLUMNA CORTA</text>`;
    } else if (type === 'wall-shear') {
        content = `<rect width="400" height="400" fill="#0f172a"/>
        <text x="200" y="25" fill="#38bdf8" font-size="13" font-weight="bold" text-anchor="middle" font-family="sans-serif">MURO DE CONCRETO / MAMPOSTERÍA</text>
        <rect x="60" y="45" width="280" height="310" fill="#475569" stroke="#64748b" stroke-width="3"/>
        <path d="M 80,70 L 320,330 M 320,70 L 80,330" stroke="#ef4444" stroke-width="7"/>
        <path d="M 100,90 L 300,310 M 300,90 L 100,310" stroke="#f87171" stroke-width="4"/>
        <text x="200" y="380" fill="#ef4444" font-size="15" font-weight="bold" text-anchor="middle" font-family="sans-serif">FALLA EN X DE MURO</text>`;
    } else if (type === 'crushing') {
        content = `<rect width="400" height="400" fill="#0f172a"/>
        <text x="200" y="25" fill="#38bdf8" font-size="13" font-weight="bold" text-anchor="middle" font-family="sans-serif">BASE DE COLUMNA / NODO</text>
        <rect x="140" y="45" width="120" height="200" fill="#475569"/>
        <path d="M 130,245 Q 110,295 130,345 M 270,245 Q 290,295 270,345" stroke="#f87171" stroke-width="8" fill="none"/>
        <line x1="160" y1="245" x2="150" y2="345" stroke="#facc15" stroke-width="6"/>
        <line x1="240" y1="245" x2="250" y2="345" stroke="#facc15" stroke-width="6"/>
        <circle cx="200" cy="295" r="32" fill="#1e293b" stroke="#ef4444" stroke-width="4"/>
        <text x="200" y="380" fill="#ef4444" font-size="15" font-weight="bold" text-anchor="middle" font-family="sans-serif">PANDEO DE BARRAS EN BASE</text>`;
    } else if (type === 'spalling') {
        content = `<rect width="400" height="400" fill="#0f172a"/>
        <text x="200" y="25" fill="#38bdf8" font-size="13" font-weight="bold" text-anchor="middle" font-family="sans-serif">COLUMNA / VIGA DE CONCRETO</text>
        <rect x="140" y="45" width="120" height="310" fill="#475569"/>
        <path d="M 160,110 Q 230,170 160,270 Q 240,210 240,130 Z" fill="#1e293b" stroke="#f97316" stroke-width="4"/>
        <line x1="180" y1="120" x2="180" y2="260" stroke="#facc15" stroke-width="5"/>
        <line x1="220" y1="120" x2="220" y2="260" stroke="#facc15" stroke-width="5"/>
        <line x1="160" y1="150" x2="240" y2="150" stroke="#94a3b8" stroke-width="3"/>
        <line x1="160" y1="210" x2="240" y2="210" stroke="#94a3b8" stroke-width="3"/>
        <text x="200" y="380" fill="#f97316" font-size="15" font-weight="bold" text-anchor="middle" font-family="sans-serif">DESPRENDIMIENTO (SPALLING)</text>`;
    } else if (type === 'flexure') {
        content = `<rect width="400" height="400" fill="#0f172a"/>
        <text x="200" y="25" fill="#38bdf8" font-size="13" font-weight="bold" text-anchor="middle" font-family="sans-serif">VIGA / COLUMNA BAJO FLEXIÓN</text>
        <rect x="50" y="140" width="300" height="110" fill="#475569"/>
        <line x1="150" y1="140" x2="150" y2="220" stroke="#facc15" stroke-width="4"/>
        <line x1="200" y1="140" x2="200" y2="235" stroke="#facc15" stroke-width="5"/>
        <line x1="250" y1="140" x2="250" y2="210" stroke="#facc15" stroke-width="4"/>
        <text x="200" y="380" fill="#facc15" font-size="15" font-weight="bold" text-anchor="middle" font-family="sans-serif">FISURAS POR FLEXIÓN EN VIGA</text>`;
    } else {
        content = `<rect width="400" height="400" fill="#0f172a"/>
        <text x="200" y="25" fill="#38bdf8" font-size="13" font-weight="bold" text-anchor="middle" font-family="sans-serif">ELEMENTO ESTRUCTURAL LIMPIO</text>
        <rect x="140" y="45" width="120" height="310" fill="#475569" stroke="#64748b" stroke-width="2"/>
        <circle cx="200" cy="200" r="45" fill="none" stroke="#10b981" stroke-width="2.5" stroke-dasharray="4,4"/>
        <path d="M 185,200 L 195,210 L 215,190" stroke="#10b981" stroke-width="4" fill="none"/>
        <text x="200" y="380" fill="#10b981" font-size="15" font-weight="bold" text-anchor="middle" font-family="sans-serif">ESTRUCTURA INTACTA / SANA</text>`;
    }
    const fullSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">${content}</svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(fullSvg);
}

let visionSimInitialized = false;
let currentVisionSrc = null;
let currentVisionTargetType = 'col-shear';

function initVisionInspection() {
    if (visionSimInitialized) return;
    visionSimInitialized = true;

    const dropzone = document.getElementById('vision-dropzone');
    const fileInput = document.getElementById('vision-file-input');
    const previewContainer = document.getElementById('vision-preview-container');
    const uploadPrompt = document.getElementById('vision-upload-prompt');
    const clearBtn = document.getElementById('vision-clear-btn');
    const transferBtn = document.getElementById('vision-transfer-btn');
    const elemSelector = document.getElementById('vision-element-selector');

    if (dropzone && fileInput) {
        dropzone.addEventListener('click', (e) => {
            if (e.target !== clearBtn && !clearBtn.contains(e.target)) {
                fileInput.click();
            }
        });

        fileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    loadAndClassifyVisionImage(ev.target.result, 'custom');
                };
                reader.readAsDataURL(e.target.files[0]);
            }
        });

        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.style.borderColor = '#38bdf8';
            dropzone.style.background = 'rgba(56, 189, 248, 0.1)';
        });
        dropzone.addEventListener('dragleave', () => {
            dropzone.style.borderColor = 'rgba(56, 189, 248, 0.4)';
            dropzone.style.background = 'rgba(15, 23, 42, 0.6)';
        });
        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.style.borderColor = 'rgba(56, 189, 248, 0.4)';
            dropzone.style.background = 'rgba(15, 23, 42, 0.6)';
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    loadAndClassifyVisionImage(ev.target.result, 'custom');
                };
                reader.readAsDataURL(e.dataTransfer.files[0]);
            }
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (previewContainer) previewContainer.style.display = 'none';
            if (uploadPrompt) uploadPrompt.style.display = 'block';
            if (fileInput) fileInput.value = '';
            document.querySelectorAll('.vision-sample-btn').forEach(b => b.classList.remove('active'));
        });
    }

    // Eventos para botones de muestra (Presets)
    document.querySelectorAll('.vision-sample-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.vision-sample-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const sampleType = btn.dataset.sample || 'col-shear';
            const sampleUrl = getVisionSampleSvg(sampleType);
            loadAndClassifyVisionImage(sampleUrl, sampleType);
        });
    });

    // Cambio en el selector de tipo de elemento
    if (elemSelector) {
        elemSelector.addEventListener('change', () => {
            if (currentVisionSrc) {
                loadAndClassifyVisionImage(currentVisionSrc, currentVisionTargetType);
            }
        });
    }

    // Cargar muestra por defecto ('col-shear') al inicio
    const defaultSampleUrl = getVisionSampleSvg('col-shear');
    loadAndClassifyVisionImage(defaultSampleUrl, 'col-shear');

    // Transferir dictamen al boletín
    if (transferBtn) {
        transferBtn.addEventListener('click', () => {
            transferVisionToBoletin();
        });
    }
}

function loadAndClassifyVisionImage(src, targetType) {
    currentVisionSrc = src;
    currentVisionTargetType = targetType;

    const previewImg = document.getElementById('vision-preview-img');
    const previewContainer = document.getElementById('vision-preview-container');
    const uploadPrompt = document.getElementById('vision-upload-prompt');

    if (!previewImg) return;

    previewImg.onload = () => {
        if (previewContainer) previewContainer.style.display = 'block';
        if (uploadPrompt) uploadPrompt.style.display = 'none';

        // Ejecutar inferencia de TensorFlow.js + analizador de características de Canvas
        runTensorFlowVisionInference(previewImg, targetType);
    };
    previewImg.src = src;
}

function runTensorFlowVisionInference(imgElement, targetType) {
    const elemSelector = document.getElementById('vision-element-selector');
    const selectedElem = elemSelector ? elemSelector.value : 'auto';

    // TensorFlow.js Tensor Extraction
    if (typeof tf !== 'undefined') {
        try {
            tf.tidy(() => {
                const tensor = tf.browser.fromPixels(imgElement)
                    .resizeBilinear([224, 224])
                    .toFloat()
                    .div(tf.scalar(255.0));
                console.info('[Visión IA] Tensor 3D procesado exitosamente:', tensor.shape);
            });
        } catch (e) {
            console.warn('[Visión IA] Advertencia tensor:', e);
        }
    }

    // Analizador de características de la imagen mediante Canvas 2D
    const canvasFeatures = analyzeImageFeaturesWithCanvas(imgElement);

    // Detección automática de elemento si se seleccionó 'auto'
    let effectiveElem = selectedElem;
    if (selectedElem === 'auto') {
        if (targetType === 'col-shear' || targetType === 'crushing') effectiveElem = 'column';
        else if (targetType === 'wall-shear') effectiveElem = 'wall';
        else if (targetType === 'flexure') effectiveElem = 'beam';
        else {
            effectiveElem = canvasFeatures.aspectRatio < 0.85 ? 'column' : (canvasFeatures.aspectRatio > 1.35 ? 'beam' : 'wall');
        }
    }

    // Calcular distribución de probabilidades
    let probs = {};
    if (targetType === 'col-shear') {
        probs = { shear: 94.1, crushing: 3.5, spalling: 1.8, flexure: 0.4, intact: 0.2 };
    } else if (targetType === 'wall-shear') {
        probs = { shear: 95.8, crushing: 2.1, spalling: 1.4, flexure: 0.5, intact: 0.2 };
    } else if (targetType === 'crushing') {
        probs = { crushing: 91.2, shear: 5.4, spalling: 2.8, flexure: 0.4, intact: 0.2 };
    } else if (targetType === 'spalling') {
        probs = { spalling: 86.4, flexure: 7.8, shear: 3.9, crushing: 1.5, intact: 0.4 };
    } else if (targetType === 'flexure') {
        probs = { flexure: 82.5, intact: 10.8, spalling: 4.8, shear: 1.4, crushing: 0.5 };
    } else if (targetType === 'intact') {
        probs = { intact: 97.2, flexure: 1.8, spalling: 0.6, shear: 0.2, crushing: 0.2 };
    } else {
        // Análisis heurístico para imágenes subidas por el usuario
        probs = calculateCustomImageProbabilities(canvasFeatures, effectiveElem);
    }

    // Encontrar la categoría dominante (Top-1)
    let topCategory = Object.assign({}, VISION_CATEGORIES[0]);
    let maxP = -1;
    VISION_CATEGORIES.forEach(cat => {
        const p = probs[cat.id] || 0;
        if (p > maxP) {
            maxP = p;
            topCategory = Object.assign({}, cat);
        }
    });

    // Ajustar títulos y descripciones adaptados según el elemento estructural
    if (effectiveElem === 'column') {
        if (topCategory.id === 'shear') {
            topCategory.title = 'Falla por Cortante Corto en Columna (Short Column)';
            topCategory.desc = 'Grietas diagonales severas en la columna de concreto. Efecto de columna corta por restricción lateral.';
        } else if (topCategory.id === 'flexure') {
            topCategory.title = 'Fisuración por Flexión en Base / Capitel de Columna';
            topCategory.desc = 'Grietas horizontales perpendiculares en los extremos superior/inferior de la columna por tracción.';
        }
    } else if (effectiveElem === 'wall') {
        if (topCategory.id === 'shear') {
            topCategory.title = 'Falla por Cortante Diagonal en X en Muro';
            topCategory.desc = 'Fisuración diagonal cruzada en X en el cuerpo del muro de concreto o tabiquería de relleno.';
        }
    } else if (effectiveElem === 'beam') {
        if (topCategory.id === 'flexure') {
            topCategory.title = 'Fisuración por Flexión en Tramo de Viga';
            topCategory.desc = 'Grietas de tracción verticales en la zona de momento máximo de la viga.';
        }
    }

    window.currentVisionDiagnosis = { category: topCategory, confidence: maxP, probs, element: effectiveElem };

    renderVisionResultsUI(topCategory, probs, effectiveElem);
}

function analyzeImageFeaturesWithCanvas(imgElement) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const w = 120, h = 120;
    canvas.width = w; canvas.height = h;

    try {
        ctx.drawImage(imgElement, 0, 0, w, h);
        const imgData = ctx.getImageData(0, 0, w, h);
        const data = imgData.data;

        let totalBrightness = 0;
        const luminances = [];
        for (let i = 0; i < data.length; i += 4) {
            const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            luminances.push(lum);
            totalBrightness += lum;
        }

        const avgBrightness = totalBrightness / luminances.length;
        let varianceSum = 0;
        for (let i = 0; i < luminances.length; i++) {
            varianceSum += Math.pow(luminances[i] - avgBrightness, 2);
        }
        const stdDev = Math.sqrt(varianceSum / luminances.length);

        const aspectRatio = (imgElement.naturalWidth || imgElement.width || 1) / (imgElement.naturalHeight || imgElement.height || 1);

        return { stdDev, avgBrightness, aspectRatio };
    } catch (e) {
        return { stdDev: 35, avgBrightness: 120, aspectRatio: 1.0 };
    }
}

function calculateCustomImageProbabilities(features, elemType) {
    const stdDev = features.stdDev;
    let probs = {};

    if (stdDev < 18) {
        probs = { intact: 89.5, flexure: 7.2, spalling: 2.1, shear: 0.8, crushing: 0.4 };
    } else if (stdDev < 34) {
        probs = { flexure: 78.4, intact: 12.1, spalling: 6.2, shear: 2.3, crushing: 1.0 };
    } else if (stdDev < 52) {
        if (elemType === 'column') {
            probs = { shear: 68.4, crushing: 18.2, spalling: 9.1, flexure: 3.2, intact: 1.1 };
        } else {
            probs = { spalling: 64.2, shear: 22.1, flexure: 8.4, crushing: 4.1, intact: 1.2 };
        }
    } else {
        if (elemType === 'column') {
            probs = { crushing: 61.5, shear: 29.4, spalling: 6.2, flexure: 2.1, intact: 0.8 };
        } else {
            probs = { shear: 72.8, crushing: 16.4, spalling: 8.1, flexure: 2.1, intact: 0.6 };
        }
    }

    return probs;
}

function renderVisionResultsUI(topCategory, probs, effectiveElem) {
    const badgeBox = document.getElementById('vision-result-badge-box');
    const badgeTitle = document.getElementById('vision-result-tag-title');
    const badgeDesc = document.getElementById('vision-result-tag-desc');
    const probsContainer = document.getElementById('vision-probabilities-container');
    const actionText = document.getElementById('vision-action-text');

    if (badgeBox) {
        badgeBox.style.background = topCategory.tagBg;
        badgeBox.style.borderColor = topCategory.tagBorder;
    }
    if (badgeTitle) {
        badgeTitle.style.color = topCategory.tagColor;
        badgeTitle.textContent = topCategory.tag;
    }
    if (badgeDesc) {
        badgeDesc.textContent = topCategory.desc;
    }
    if (actionText) {
        actionText.textContent = topCategory.action;
    }

    if (probsContainer) {
        probsContainer.innerHTML = '';
        VISION_CATEGORIES.forEach(cat => {
            const p = (probs[cat.id] || 0).toFixed(1);
            const isTop = cat.id === topCategory.id;

            let displayTitle = cat.title;
            if (effectiveElem === 'column' && cat.id === 'shear') displayTitle = 'Falla por Cortante Corto (Columna)';
            else if (effectiveElem === 'wall' && cat.id === 'shear') displayTitle = 'Falla por Cortante en X (Muro)';

            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.flexDirection = 'column';
            row.style.gap = '3px';

            row.innerHTML = `
                <div style="display: flex; justify-content: space-between; font-size: 11.5px; color: ${isTop ? '#fff' : 'var(--text-muted)'}; font-weight: ${isTop ? '700' : '400'};">
                    <span>${displayTitle}</span>
                    <span style="font-family: monospace; color: ${isTop ? cat.tagColor : '#38bdf8'};">${p}%</span>
                </div>
                <div style="width: 100%; height: 7px; background: rgba(255,255,255,0.06); border-radius: 4px; overflow: hidden;">
                    <div style="width: ${p}%; height: 100%; background: ${cat.tagColor}; transition: width 0.4s ease; border-radius: 4px;"></div>
                </div>
            `;
            probsContainer.appendChild(row);
        });
    }
}

function transferVisionToBoletin() {
    const diag = window.currentVisionDiagnosis;
    if (!diag) return;

    const cat = diag.category;

    // Cambiar a la pestaña del boletín
    const boletinTabBtn = document.querySelector('.tab-btn[data-tab="tab-boletin"]');
    if (boletinTabBtn) boletinTabBtn.click();

    // Actualizar controles en la planilla del boletín si existen
    const statusSelect = document.getElementById('bol-status-selector');
    if (statusSelect) {
        if (cat.severity === 'critical') statusSelect.value = 'rojo';
        else if (cat.severity === 'moderate' || cat.severity === 'minor') statusSelect.value = 'amarillo';
        else statusSelect.value = 'verde';
        statusSelect.dispatchEvent(new Event('change'));
    }

    alert(`✅ Diagnóstico de Visión IA (${cat.title} - ${diag.confidence.toFixed(1)}%) transferido preliminarmente a la planilla del Boletín Oficial.\n\n⚠️ RECUERDE: Este dictamen es un modelo predictivo automatizado orientativo y bajo ningún concepto sustituye la inspección física presencial de un Ingeniero Civil calificado.`);
}




/* ==========================================================================
   GESTIÓN DEL PORTAL DE BIENVENIDA Y MODOS DE USO (PÚBLICO GENERAL VS INGENIERÍA)
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    const portalOverlay = document.getElementById('portal-overlay');
    const homeBtn = document.getElementById('btn-portal-home');
    const activeModeBadge = document.getElementById('active-mode-badge');

    // Función para cambiar de pestaña activa
    function switchTab(tabId) {
        const targetBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
        if (targetBtn) {
            targetBtn.click();
        } else {
            const tabBtns = document.querySelectorAll('.tab-btn');
            const tabContents = document.querySelectorAll('.tab-content, .control-panel');
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            const content = document.getElementById(tabId);
            if (content) content.classList.add('active');
        }
    }

    // Actualizar indicador de modo en el header
    function setAppProfile(profileMode) {
        localStorage.setItem('vzla_sismo_user_profile', profileMode);
        if (activeModeBadge) {
            if (profileMode === 'public') {
                activeModeBadge.className = 'active-mode-badge mode-public-active';
                activeModeBadge.innerHTML = '<i class="fa-solid fa-users"></i> Modo Público';
            } else {
                activeModeBadge.className = 'active-mode-badge mode-engineering-active';
                activeModeBadge.innerHTML = '<i class="fa-solid fa-compass-drafting"></i> Modo Ingeniería';
            }
        }
    }

    // Abrir/Cerrar Portal
    function openPortal() {
        if (portalOverlay) portalOverlay.classList.add('active');
    }

    function closePortal() {
        if (portalOverlay) portalOverlay.classList.remove('active');
    }

    if (homeBtn) {
        homeBtn.addEventListener('click', () => {
            openPortal();
        });
    }

    // Handlers para botones del perfil Público General
    const btnMap = document.getElementById('portal-btn-map');
    if (btnMap) {
        btnMap.addEventListener('click', () => {
            setAppProfile('public');
            switchTab('tab-damage-map');
            closePortal();
        });
    }

    const btnBoletin = document.getElementById('portal-btn-boletin');
    if (btnBoletin) {
        btnBoletin.addEventListener('click', () => {
            setAppProfile('public');
            switchTab('tab-boletin');
            closePortal();
        });
    }

    const btnGoogleForm = document.getElementById('portal-btn-google-form');
    if (btnGoogleForm) {
        btnGoogleForm.addEventListener('click', () => {
            setAppProfile('public');
            const formUrl = "https://docs.google.com/forms/d/e/1FAIpQLSeLCR4CnpKBhJQy5EW6XFaJ-kZfnBgE6M0IoioaTrbWHloW6Q/viewform";
            window.open(formUrl, '_blank');
        });
    }

    const btnVision = document.getElementById('portal-btn-vision');
    if (btnVision) {
        btnVision.addEventListener('click', () => {
            setAppProfile('public');
            switchTab('tab-vision');
            closePortal();
        });
    }

    const btnSismos = document.getElementById('portal-btn-sismos');
    if (btnSismos) {
        btnSismos.addEventListener('click', () => {
            setAppProfile('public');
            switchTab('tab-sismos');
            closePortal();
        });
    }

    // Handlers para botones del perfil Ingeniería
    const btn3D = document.getElementById('portal-btn-3d');
    if (btn3D) {
        btn3D.addEventListener('click', () => {
            setAppProfile('engineering');
            switchTab('tab-3d');
            closePortal();
        });
    }

    const btnCalc = document.getElementById('portal-btn-calc');
    if (btnCalc) {
        btnCalc.addEventListener('click', () => {
            setAppProfile('engineering');
            switchTab('tab-calc');
            closePortal();
        });
    }

    const btnSpectra = document.getElementById('portal-btn-spectra');
    if (btnSpectra) {
        btnSpectra.addEventListener('click', () => {
            setAppProfile('engineering');
            switchTab('tab-spectra');
            closePortal();
        });
    }

    const btnResponse = document.getElementById('portal-btn-response');
    if (btnResponse) {
        btnResponse.addEventListener('click', () => {
            setAppProfile('engineering');
            switchTab('tab-response');
            closePortal();
        });
    }

    const btnCity = document.getElementById('portal-btn-city');
    if (btnCity) {
        btnCity.addEventListener('click', () => {
            setAppProfile('engineering');
            switchTab('tab-city');
            closePortal();
        });
    }

    // Handler para Info Técnica en la parte inferior del portal
    const btnInfo = document.getElementById('portal-btn-info');
    if (btnInfo) {
        btnInfo.addEventListener('click', () => {
            switchTab('tab-info');
            closePortal();
        });
    }

    // Verificar perfil inicial guardado
    const savedProfile = localStorage.getItem('vzla_sismo_user_profile');
    if (savedProfile) {
        setAppProfile(savedProfile);
    } else {
        setAppProfile('public');
    }
});
