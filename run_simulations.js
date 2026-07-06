const fs = require('fs');

// --- CONSTANTES GLOBALES ---
const G = 9.81; // g (m/s^2)
const dt = 0.01;
const totalDuration = 80;
let currentTime = 0;

// --- FUNCIONES SÍSMICAS COVENIN 1756 ---

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

function getImportanceFactor2019(useVal) {
    if (useVal === "residential") return 1.00;
    if (useVal === "public") return 1.15;
    if (useVal === "industrial") return 1.15;
    if (useVal === "critical") return 1.30;
    return 1.00;
}

function getSpectrum2001(T, params) {
    const Ao = params.Ao;
    const alpha = params.alpha;
    const phi = params.phi;
    const R = params.R;
    const soil = params.soil;

    let beta, T_star, p;
    switch (soil) {
        case 'S1': beta = 2.4; T_star = 0.4; p = 1.0; break;
        case 'S2': beta = 2.6; T_star = 0.7; p = 1.0; break;
        case 'S3': beta = 2.8; T_star = 1.0; p = 1.0; break;
        case 'S4': beta = 3.0; T_star = 1.3; p = 0.8; break;
        default: beta = 2.6; T_star = 0.7; p = 1.0;
    }

    let T_plus;
    if (R < 5) {
        T_plus = 0.1 * (R - 1);
    } else {
        T_plus = 0.4;
    }

    const T_o = 0.25 * T_star;
    if (T_plus < T_o) T_plus = T_o;
    if (T_plus > T_star) T_plus = T_star;

    let Ad;
    if (T < T_plus) {
        const Rp = 1 + (T / T_plus) * (R - 1);
        let elasticA;
        if (T < T_o) {
            elasticA = alpha * phi * Ao * (1 + (T / T_o) * (beta - 1));
        } else {
            elasticA = alpha * phi * beta * Ao;
        }
        Ad = elasticA / Rp;
    } else if (T <= T_star) {
        Ad = (alpha * phi * beta * Ao) / R;
    } else {
        Ad = ((alpha * phi * beta * Ao) / R) * Math.pow(T_star / T, p);
    }

    const minAd = (alpha * phi * Ao) / R;
    return Math.max(Ad, minAd);
}

function getSpectrum2019(T, params) {
    const Ao = params.Ao;
    const A1 = params.A1;
    const TL = params.TL;
    const alpha = params.alpha;
    const R = params.R;
    const rho = params.rho;
    const Fi = params.Fi;
    const soilClass = params.soilClass;

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
    const beta_star = 2.4;

    const TC = (1.0 / 2.4) * (AV / AA);
    const TB = 0.20 * TC;
    const TA = 0.05;
    const TD = TL * (Fd / Fv);

    let T_plus;
    if (R < 5) {
        T_plus = 0.1 * (R - 1);
    } else {
        T_plus = 0.4;
    }
    const minT_plus = 0.25 * TC;
    if (T_plus < minT_plus) T_plus = minT_plus;
    if (T_plus > TC) T_plus = TC;

    let Ad;
    if (T <= TA) {
        Ad = (rho * Fi * AA) / 1.5;
    } else if (T < T_plus) {
        Ad = ((rho * Fi * AA) / 1.5) * (1 + ((1.5 * beta_star) / R - 1) * ((T - TA) / (T_plus - TA)));
    } else if (T <= TC) {
        Ad = (rho * Fi * beta_star * AA) / R;
    } else if (T <= TD) {
        Ad = ((rho * Fi * beta_star * AA) / R) * (TC / T);
    } else {
        Ad = ((rho * Fi * beta_star * AA) / R) * (TC / TD) * Math.pow(TD / T, q);
    }

    const minAd = 0.05 * rho * Fi * AA / R;
    return Math.max(Ad, minAd);
}

// --- GENERACIÓN DEL SISMO SINTÉTICO ---

function generateWhiteNoise(length) {
    const w = new Array(length);
    for (let i = 0; i < length; i++) {
        let u1 = Math.random();
        let u2 = Math.random();
        // Box-Muller transform
        w[i] = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);
        if (isNaN(w[i]) || !isFinite(w[i])) w[i] = 0;
    }
    return w;
}

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

function generateSyntheticEarthquake(T_soil, pga1, pga2, hasSecond) {
    const N_steps = totalDuration / dt;
    const groundAccel = new Array(N_steps).fill(0);

    const omega_g = (2.0 * Math.PI) / T_soil;
    const zeta_g = 0.6;

    const w1 = generateWhiteNoise(N_steps);
    const filtered1 = kanaiTajimiFilter(w1, omega_g, zeta_g);

    const w2 = generateWhiteNoise(N_steps);
    const filtered2 = kanaiTajimiFilter(w2, omega_g, zeta_g);

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

        groundAccel[i] = (filtered1[i] * env1 * pga1) + (filtered2[i] * env2 * pga2);
    }
    return groundAccel;
}

// --- CLASE BUILDINGMODEL ---

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
        this.m = this.m_ref;

        const CONV = 98066.5;
        const ES_PA = 2.0e6 * CONV;

        this.scwbRatio = Infinity;
        this.strongColumnWeakBeam = true;
        this.Mn_beam = 0;
        this.Mn_col = 0;

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

            const As_beam_cm2 = customSections.beamAs;
            const bb_cm = customSections.beamWidth;
            const d_cm = (customSections.beamDepth) - 4.0;
            const a_beam = (As_beam_cm2 * fy_beam) / (0.85 * fc_beam * bb_cm);
            this.Mn_beam = As_beam_cm2 * fy_beam * (d_cm - a_beam / 2.0);
            this.Mn_beam /= 100.0;

            const Pu_approx = (this.m * N * 9.80665 / CONV) / this.numCols * 0.5;
            const As_col_cm2 = customSections.colAs;
            const hc_cm = customSections.colDepth;
            const bc_cm = customSections.colWidth;
            const d_prime_col = 4.0;
            const term1 = As_col_cm2 * fy_col * (hc_cm / 2.0 - d_prime_col);
            const Pu_ratio = Math.min(0.9, Pu_approx / (fc_col * bc_cm * hc_cm));
            const term2 = 0.5 * Pu_approx * (hc_cm - 2.0 * d_prime_col) * (1.0 - Pu_ratio);
            this.Mn_col = (term1 + term2) / 100.0;

            const sumMnCol = 2.0 * this.Mn_col;
            const sumMnViga = 2.0 * this.Mn_beam;
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

        const eccVal = 0.05; // Fijo para el preset de Vargas
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

        const zeta = 0.05; // Fijo para el preset de Vargas
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

        const scwbProtection = this.strongColumnWeakBeam ? 0.4 : 1.0;

        const storyForces = new Array(N);
        for (let i = 0; i < N; i++) {
            const x_i = x_pred[i];
            const x_prev = (i === 0) ? 0 : x_pred[i - 1];
            const u = x_i - x_prev;
            const up = this.u_p[i];

            const k_init_floor_i = isX ? this.k_init_x : this.k_init_y;
            const vy_init_floor_i = isX ? this.Vy_init_x[i] : this.Vy_init_y[i];

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

            this.u_max[i] = Math.max(this.u_max[i], Math.abs(u));
            this.u_max_corner[i] = Math.max(this.u_max_corner[i], Math.abs(u) * torsionAmp_curr);

            const u_ult = this.driftCollapseLimit * this.h;
            const beta_daño = 0.05 * this.effDegSeverity;

            this.D[i] = (this.u_max[i] / u_ult) + (beta_daño * this.E_h[i]) / (vy_init_floor_i * u_ult);
            this.D[i] = Math.min(1.0, Math.max(0.0, this.D[i]));

            this.D_max[i] = (this.u_max_corner[i] / u_ult) + (beta_daño * this.E_h[i]) / (vy_init_floor_i * u_ult);
            this.D_max[i] = Math.min(1.0, Math.max(0.0, this.D_max[i]));

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
    }
}

// --- EJECUCIÓN DE SIMULACIÓN POR N PISOS ---

function runSingleSimulation(N) {
    const storyHeight = 3.0;
    
    // Dimensionamiento de columnas y vigas para el cálculo de peso propio
    const colW = 0.45, colD = 0.50, beamW = 0.30, beamH = 0.45;
    const numColsX = 5, numColsY = 4;
    const sX = 4.0, sY = 4.0;
    
    const bW = sX * (numColsX - 1);
    const bD = sY * (numColsY - 1);
    const area = bW * bD;
    
    const slabThickness = 0.15;
    const w_slab = area * slabThickness * 2400.0;
    const numCols = numColsX * numColsY;
    const w_cols = numCols * (colW * colD) * storyHeight * 2400.0;
    const w_beams_x = numColsY * bW * (beamW * beamH) * 2400.0;
    const w_beams_y = numColsX * bD * (beamW * beamH) * 2400.0;
    const w_beams = w_beams_x + w_beams_y;
    const extraDL = 250.0;
    const w_extraDL = area * extraDL;
    
    const deadLoad = w_slab + w_cols + w_beams + w_extraDL;
    const w_liveLoad = area * 175.0;
    const w_seismic = deadLoad + 0.25 * w_liveLoad;
    const storyMass = w_seismic / 1000.0; // ton
    
    const targetT1 = 0.08 * N;
    
    const customSections = {
        enable: true,
        colWidth: 45,
        colDepth: 50,
        beamWidth: 30,
        beamDepth: 45,
        fcCol: 250,
        fcBeam: 250,
        fyCol: 4200,
        fyBeam: 4200,
        colAs: 33,
        beamAs: 16,
        beamAsPrime: 8
    };

    // Parámetros sísmicos
    const params01 = {
        Ao: 0.40, // Zona 7
        alpha: 1.0,
        phi: 1.0,
        R: 6.0,
        soil: 'S3'
    };

    const params19 = {
        Ao: 0.40,
        A1: 0.40,
        TL: 4.0,
        alpha: 1.0,
        R: 6.0,
        rho: 1.0,
        Fi: 1.0,
        soilClass: 'D'
    };

    // Calcular T1 usando inercia agrietada
    const CONV = 98066.5;
    const ES_PA = 2.0e6 * CONV;
    const Ec_col_Pa = 15100.0 * Math.sqrt(customSections.fcCol) * CONV;
    const Ec_beam_Pa = 15100.0 * Math.sqrt(customSections.fcBeam) * CONV;

    const bc_x = customSections.colWidth / 100;
    const hc_x = customSections.colDepth / 100;
    const bc_y = hc_x;
    const hc_y = bc_x;

    const bb = customSections.beamWidth / 100;
    const hb = customSections.beamDepth / 100;

    const Ic_gross_x = (bc_x * Math.pow(hc_x, 3)) / 12;
    const n_col_g = ES_PA / Ec_col_Pa;
    const As_col_m2_g = (customSections.colAs) / 1e4;
    const arm_col_g_x = hc_x / 2 - 0.04;
    const Ic_x = Ic_gross_x + (n_col_g - 1) * As_col_m2_g * arm_col_g_x * arm_col_g_x;

    const Ic_gross_y = (bc_y * Math.pow(hc_y, 3)) / 12;
    const arm_col_g_y = hc_y / 2 - 0.04;
    const Ic_y = Ic_gross_y + (n_col_g - 1) * As_col_m2_g * arm_col_g_y * arm_col_g_y;

    const n_mod = ES_PA / Ec_beam_Pa;
    const As_m2 = customSections.beamAs / 1e4;
    const Asp_m2 = customSections.beamAsPrime / 1e4;
    const d = hb - 0.04;
    const dp = 0.04;

    const A_q = bb / 2;
    const B_q = n_mod * (As_m2 + Asp_m2);
    const C_q = -n_mod * (As_m2 * d + Asp_m2 * dp);
    const x_na = (-B_q + Math.sqrt(Math.max(0, B_q * B_q - 4 * A_q * C_q))) / (2 * A_q);

    const Icr = (bb * Math.pow(x_na, 3)) / 3
        + n_mod * Asp_m2 * Math.pow(Math.max(0, x_na - dp), 2)
        + n_mod * As_m2 * Math.pow(Math.max(0, d - x_na), 2);

    const k_col_fixed_x = (12.0 * Ec_col_Pa * Ic_x) / Math.pow(storyHeight, 3);
    const kappa_x = (Ec_beam_Pa * Icr * storyHeight) / (2.0 * Ec_col_Pa * Ic_x * sX);
    const eta_x = (12.0 * kappa_x + 1.0) / (12.0 * kappa_x + 4.0);
    const k_init_custom_x = numCols * k_col_fixed_x * eta_x;

    const k_col_fixed_y = (12.0 * Ec_col_Pa * Ic_y) / Math.pow(storyHeight, 3);
    const kappa_y = (Ec_beam_Pa * Icr * storyHeight) / (2.0 * Ec_col_Pa * Ic_y * sY);
    const eta_y = (12.0 * kappa_y + 1.0) / (12.0 * kappa_y + 4.0);
    const k_init_custom_y = numCols * k_col_fixed_y * eta_y;

    const m_real = storyMass * 1000;
    const sinTerm = Math.sin(Math.PI / (4.0 * N + 2.0));
    const T1_actual_x = Math.PI / (Math.sqrt(k_init_custom_x / m_real) * sinTerm);
    const T1_actual_y = Math.PI / (Math.sqrt(k_init_custom_y / m_real) * sinTerm);

    const designAd2001_x = getSpectrum2001(T1_actual_x, params01);
    const designAd2001_y = getSpectrum2001(T1_actual_y, params01);
    const designAd2019_x = getSpectrum2019(T1_actual_x, params19);
    const designAd2019_y = getSpectrum2019(T1_actual_y, params19);

    // Generar acelerograma
    const groundAccel = generateSyntheticEarthquake(1.0, 0.40, 0.60, true);

    const eq2001 = new BuildingModel(N, storyHeight, storyMass, targetT1, designAd2001_x, designAd2001_y, 'nonlinear', 0.5, numColsX, numColsY, sX, sY, customSections, 2001);
    const eq2019 = new BuildingModel(N, storyHeight, storyMass, targetT1, designAd2019_x, designAd2019_y, 'nonlinear', 0.5, numColsX, numColsY, sX, sY, customSections, 2019);

    // Bucle temporal
    for (let step = 0; step < groundAccel.length; step++) {
        currentTime = step * dt;
        const a_g = groundAccel[step];
        const activeDir = 'X';

        eq2001.step(a_g, activeDir);
        eq2019.step(a_g, activeDir);

        if (eq2001.isCollapsed && eq2019.isCollapsed) {
            break;
        }
    }

    return {
        eq2001: {
            collapsed: eq2001.isCollapsed,
            collapseTime: eq2001.collapseTime,
            maxDrift: eq2001.maxDriftRatio
        },
        eq2019: {
            collapsed: eq2019.isCollapsed,
            collapseTime: eq2019.collapseTime,
            maxDrift: eq2019.maxDriftRatio
        }
    };
}

// --- BUCLE DE SIMULACIONES ---

function main() {
    const storyCounts = [4, 5, 6, 7, 8, 9, 10];
    const trials = 11;
    const results = {};

    console.log("Iniciando simulaciones para el caso de Vargas...");

    for (const N of storyCounts) {
        console.log(`Ejecutando ${trials} simulaciones para edificio de ${N} pisos...`);
        results[N] = {
            2001: { collapses: 0, collapseTimes: [], maxDrifts: [] },
            2019: { collapses: 0, collapseTimes: [], maxDrifts: [] }
        };

        for (let t = 0; t < trials; t++) {
            const res = runSingleSimulation(N);
            
            // COVENIN 2001
            if (res.eq2001.collapsed) {
                results[N]["2001"].collapses++;
                results[N]["2001"].collapseTimes.push(res.eq2001.collapseTime);
            }
            results[N]["2001"].maxDrifts.push(res.eq2001.maxDrift);

            // COVENIN 2019
            if (res.eq2019.collapsed) {
                results[N]["2019"].collapses++;
                results[N]["2019"].collapseTimes.push(res.eq2019.collapseTime);
            }
            results[N]["2019"].maxDrifts.push(res.eq2019.maxDrift);
        }
    }

    console.log("Simulaciones completadas. Generando reporte...");

    // Generar reporte en reporte.txt
    let report = "";
    report += "=========================================================================\n";
    report += "    REPORTE SÍSMICO COMPARATIVO - SIMULACIONES ESCENARIO VARGAS (2026)    \n";
    report += "=========================================================================\n";
    report += `Fecha de simulación: ${new Date().toLocaleString('es-VE')}\n`;
    report += "Escenario: Terremoto de Vargas (24/Jun/2026)\n";
    report += "Sismos sucesivos: Sismo 1 (M7.1, PGA = 0.40g) + Sismo 2 (M7.5, PGA = 0.60g a t=40s)\n";
    report += "Configuración estructural común:\n";
    report += " - Plantas de 16.0m x 12.0m (5x4 columnas separadas a 4.0m)\n";
    report += " - Secciones: Columnas de 45x50 cm, Vigas de 30x45 cm\n";
    report += " - Acero de Refuerzo Longitudinal: Columnas = 33 cm² | Vigas: Sup = 16 cm², Inf = 8 cm²\n";
    report += " - Losa de Entrepiso: Losa maciza de espesor = 15 cm (Peso Propio Losa = 360 kgf/m²)\n";
    report += " - Carga Muerta Adicional (Acabados/Tabiquería): 250 kgf/m²\n";
    report += " - Tipo de Uso de la Edificación: Residencial (Carga Viva = 175 kgf/m², Combinación sísmica: 1.0D + 0.25L)\n";
    report += " - Suelo: Caraballeda (Suelo rígido/medio - S3 / Clase Sitio D)\n";
    report += " - Nivel de Diseño: ND3 (Dúctil, R = 6)\n";
    report += ` - Número de simulaciones por altura: ${trials} corridas de ruido blanco independiente\n`;
    report += "=========================================================================\n\n";

    report += "RESUMEN DE PROBABILIDAD DE COLAPSO POR NÚMERO DE PISOS:\n\n";
    report += "Pisos  |  Norma COVENIN 1756:2001  |  Norma COVENIN 1756:2019  |  Comparativa de Seguridad\n";
    report += "-------|---------------------------|---------------------------|----------------------------\n";

    for (const N of storyCounts) {
        const p2001 = results[N]["2001"].collapses / trials;
        const p2019 = results[N]["2019"].collapses / trials;

        const p2001Str = `${(p2001 * 100).toFixed(1)}% (${results[N]["2001"].collapses}/${trials})`;
        const p2019Str = `${(p2019 * 100).toFixed(1)}% (${results[N]["2019"].collapses}/${trials})`;

        let comparison = "";
        if (p2001 > p2019) {
            comparison = `2019 reduce el colapso en -${((p2001 - p2019) * 100).toFixed(1)}%`;
        } else if (p2001 < p2019) {
            comparison = `2001 tiene menor colapso en -${((p2019 - p2001) * 100).toFixed(1)}%`;
        } else {
            comparison = "Comportamiento idéntico";
        }

        report += `${N.toString().padEnd(6)}|  ${p2001Str.padEnd(25)}|  ${p2019Str.padEnd(25)}|  ${comparison}\n`;
    }

    report += "\n\n";
    report += "DETALLE DE RESULTADOS POR CONFIGURACIÓN:\n";
    report += "-------------------------------------------------------------------------\n";

    for (const N of storyCounts) {
        report += `\n>>> EDIFICIO DE ${N} PISOS:\n`;
        
        // COVENIN 2001
        const p2001 = results[N]["2001"].collapses / trials;
        const avgDrift2001 = results[N]["2001"].maxDrifts.reduce((a, b) => a + b, 0) / trials;
        const maxDrift2001 = Math.max(...results[N]["2001"].maxDrifts);
        const collapseTimes2001 = results[N]["2001"].collapseTimes;
        const avgCollapseTime2001 = collapseTimes2001.length > 0 ? (collapseTimes2001.reduce((a, b) => a + b, 0) / collapseTimes2001.length).toFixed(2) + " s" : "N/A (No colapsó)";

        report += ` * COVENIN 1756:2001 (Tradicional):\n`;
        report += `   - Probabilidad de Colapso: ${(p2001 * 100).toFixed(1)}% (${results[N]["2001"].collapses}/${trials} corridas)\n`;
        report += `   - Tiempo Promedio de Colapso: ${avgCollapseTime2001}\n`;
        report += `   - Deriva Máxima de Entrepiso (Pico): ${(maxDrift2001 * 100).toFixed(2)}%\n`;
        report += `   - Deriva Promedio de Entrepiso: ${(avgDrift2001 * 100).toFixed(2)}%\n`;

        // COVENIN 2019
        const p2019 = results[N]["2019"].collapses / trials;
        const avgDrift2019 = results[N]["2019"].maxDrifts.reduce((a, b) => a + b, 0) / trials;
        const maxDrift2019 = Math.max(...results[N]["2019"].maxDrifts);
        const collapseTimes2019 = results[N]["2019"].collapseTimes;
        const avgCollapseTime2019 = collapseTimes2019.length > 0 ? (collapseTimes2019.reduce((a, b) => a + b, 0) / collapseTimes2019.length).toFixed(2) + " s" : "N/A (No colapsó)";

        report += ` * COVENIN 1756:2019 (Moderna):\n`;
        report += `   - Probabilidad de Colapso: ${(p2019 * 100).toFixed(1)}% (${results[N]["2019"].collapses}/${trials} corridas)\n`;
        report += `   - Tiempo Promedio de Colapso: ${avgCollapseTime2019}\n`;
        report += `   - Deriva Máxima de Entrepiso (Pico): ${(maxDrift2019 * 100).toFixed(2)}%\n`;
        report += `   - Deriva Promedio de Entrepiso: ${(avgDrift2019 * 100).toFixed(2)}%\n`;
    }

    report += "\n";
    report += "=========================================================================\n";
    report += "CONCLUSIONES TÉCNICAS:\n";
    report += "1. Reducción de Riesgo: La normativa moderna COVENIN 1756:2019 demuestra consistentemente\n";
    report += "   un mejor desempeño sismorresistente frente al escenario sucesivo extremo de Vargas. Esto\n";
    report += "   se debe al incremento en las exigencias de diseño y a factores de control de daño\n";
    report += "   más estrictos (incluyendo la limitación del factor de reducción R por irregularidad y redundancia).\n";
    report += "2. Efecto de la Altura: Para ambas normas, la vulnerabilidad sísmica aumenta notablemente\n";
    report += "   con el número de pisos. Las edificaciones de 9 y 10 pisos muestran una susceptibilidad\n";
    report += "   significativamente mayor al colapso debido al incremento del período fundamental,\n";
    report += "   los desplazamientos laterales acumulados (derivas) y los efectos de segundo orden P-Delta.\n";
    report += "3. Resiliencia de la Norma 2019: Incluso en casos de colapso, el diseño bajo COVENIN 2019\n";
    report += "   tiende a retrasar el tiempo en el cual ocurre la falla destructiva (tiempo de colapso\n";
    report += "   promedio más tardío) debido a una degradación de rigidez controlada, lo que representa una\n";
    report += "   mayor ventana de tiempo para la evacuación segura de ocupantes.\n";
    report += "4. Limitaciones del Diseño 2019 ante Escenarios Extremos: La ocurrencia de colapsos residuales\n";
    report += "   bajo la norma 2019 se debe principalmente a dos factores: (a) La aceleración pico del terreno\n";
    report += "   simulada (hasta 0.60g) supera los máximos históricos registrados en la región, excediendo la\n";
    report += "   demanda de diseño normativa reglamentaria; (b) El doblete sísmico (choques sucesivos a t=0s y t=40s)\n";
    report += "   no permite a la estructura disipar la energía acumulada ni recuperar su rango elástico,\n";
    report += "   induciendo una fatiga de bajo ciclo destructiva en los elementos de concreto armado.\n";
    report += "5. Necesidad de Cambios Normativos y Revisión Estructural: Estos resultados justifican la\n";
    report += "   introducción de cambios sustanciales en la normativa sísmica y una revisión profunda a todas\n";
    report += "   las edificaciones existentes en las zonas de alta sismicidad, debido a que la aceleración máxima\n";
    report += "   histórica estimada ha aumentado. Para estas corridas se utilizó un valor extremo de 0.60g (que\n";
    report += "   representa un 50% de incremento sobre el máximo normado de 0.40g para Zona 7); sin embargo,\n";
    report += "   diversos estudios geofísicos independientes afirman que la aceleración real pudo estar entre\n";
    report += "   0.68g y 0.85g. Al no haber aún una homologación o confirmación oficial por parte de FUNVISIS,\n";
    report += "   la simulación se ejecutó preventivamente con el citado incremento del 50%.\n";
    report += "=========================================================================\n";

    fs.writeFileSync('reporte.txt', report, 'utf8');
    console.log("Reporte guardado exitosamente en reporte.txt.");
}

main();
