const fs = require('fs');

/**
 * Calculates standard deviation of an array
 */
function getStd(array) {
  if (!array || array.length === 0) return 0;
  const n = array.length;
  const mean = array.reduce((a, b) => a + b, 0) / n;
  return Math.sqrt(array.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / n);
}

/**
 * Parses ECG file content.
 * Supports CSV and whitespace-separated values.
 * Tries to detect header and sampling rate.
 */
function parseECGFile(content) {
  const lines = content.trim().split('\n');
  let data = [];
  let sampleRate = 1000; // Default 1000 Hz

  // Simple heuristic for header
  let startIdx = 0;
  // If first line contains text/letters, skip it
  if (lines.length > 0 && /[a-zA-Z]/.test(lines[0])) {
    // Try to extract sample rate from header if present (e.g., "Sampling Rate: 500 Hz")
    const srMatch = lines[0].match(/rate.*?(\d+)/i);
    if (srMatch) {
      sampleRate = parseInt(srMatch[1]);
    }
    startIdx = 1;
  }

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Split by comma or whitespace
    const parts = line.split(/[,\s]+/);
    for (const p of parts) {
      const val = parseFloat(p);
      if (!isNaN(val)) {
        data.push(val);
        break;
      }
    }
  }

  return { data, sampleRate };
}

/**
 * Parses generic data file (EMG/Eye)
 */
function parseDataFile(content, columns = 1) {
    const lines = content.trim().split('\n');
    const data = [];
    
    // Skip potential header lines
    let startIdx = 0;
    if (lines.length > 0 && /[a-zA-Z]/.test(lines[0])) {
        startIdx = 1; // Basic skip
    }

    for (let i = startIdx; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const parts = line.split(/[,\s]+/);
        const row = [];
        for (let j = 0; j < Math.min(parts.length, columns); j++) {
            const val = parseFloat(parts[j]);
            row.push(isNaN(val) ? 0 : val);
        }
        if (row.length > 0) data.push(row);
    }
    return data;
}

/**
 * Downsamples signal to a target count using simple stride.
 * Returns sampled data and the effective stride used.
 */
function downsampleSignal(data, targetCount = 20000) {
  if (data.length <= targetCount) {
    return { data, stride: 1 };
  }
  
  const stride = Math.ceil(data.length / targetCount);
  const sampled = [];
  
  for (let i = 0; i < data.length; i += stride) {
    sampled.push(data[i]);
  }
  
  return { data: sampled, stride };
}

function detectRPeaks(signal, sampleRate) {
  if (!signal || signal.length < 3) return [];
  const n = signal.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += signal[i];
  const mean = sum / n;
  let varSum = 0;
  for (let i = 0; i < n; i++) {
    const d = signal[i] - mean;
    varSum += d * d;
  }
  const std = Math.sqrt(varSum / n);
  const threshold = mean + 0.5 * std;
  const refractorySamples = Math.max(1, Math.round(sampleRate * 0.25));
  const peaks = [];
  let lastPeak = -refractorySamples;
  for (let i = 1; i < n - 1; i++) {
    const v = signal[i];
    if (v <= threshold) continue;
    if (v <= signal[i - 1]) continue;
    if (v < signal[i + 1]) continue;
    if (i - lastPeak < refractorySamples) continue;
    peaks.push(i);
    lastPeak = i;
  }
  return peaks;
}

function computeEmgTimeFeatures(data) {
  const n = data.length;
  if (!n) return { mav: 0, rms: 0, iemg: 0, maxAmp: 0 };
  let sumAbs = 0;
  let sumSq = 0;
  let maxAbs = 0;
  for (let i = 0; i < n; i++) {
    const v = data[i];
    const av = v < 0 ? -v : v;
    sumAbs += av;
    sumSq += v * v;
    if (av > maxAbs) maxAbs = av;
  }
  const mav = sumAbs / n;
  const rms = Math.sqrt(sumSq / n);
  const iemg = sumAbs;
  const maxAmp = maxAbs;
  return { mav, rms, iemg, maxAmp };
}

function computeEmgFreqFeatures(data, sampleRate) {
  const n = Math.min(data.length, 4096);
  if (!n) return { mdf: 0, mpf: 0 };
  const x = new Float64Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) {
    mean += data[i];
  }
  mean /= n;
  for (let i = 0; i < n; i++) {
    x[i] = data[i] - mean;
  }
  const maxK = Math.floor(n / 2);
  const psd = new Float64Array(maxK);
  let totalPower = 0;
  for (let k = 0; k < maxK; k++) {
    let re = 0;
    let im = 0;
    const angBase = -2 * Math.PI * k / n;
    for (let i = 0; i < n; i++) {
      const ang = angBase * i;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const v = x[i];
      re += v * c;
      im += v * s;
    }
    const p = re * re + im * im;
    psd[k] = p;
    totalPower += p;
  }
  if (totalPower <= 0) return { mdf: 0, mpf: 0 };
  const df = sampleRate / n;
  let cum = 0;
  const halfPower = totalPower * 0.5;
  let mdf = 0;
  let num = 0;
  for (let k = 0; k < maxK; k++) {
    const p = psd[k];
    const f = k * df;
    cum += p;
    if (!mdf && cum >= halfPower) {
      mdf = f;
    }
    num += f * p;
  }
  const mpf = num / totalPower;
  return { mdf, mpf };
}

function analyzeECG(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error('File not found');
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const { data, sampleRate } = parseECGFile(content);

    if (data.length === 0) {
      throw new Error('No valid data found in file');
    }

    const peaks = detectRPeaks(data, sampleRate);
    const rrSamples = [];
    for (let i = 1; i < peaks.length; i++) {
      rrSamples.push(peaks[i] - peaks[i - 1]);
    }
    const rrMs = rrSamples.map(v => v * 1000 / sampleRate);
    let meanRR = 0;
    if (rrMs.length > 0) {
      let s = 0;
      for (let i = 0; i < rrMs.length; i++) s += rrMs[i];
      meanRR = s / rrMs.length;
    }
    let sdnn = 0;
    if (rrMs.length > 1) {
      sdnn = getStd(rrMs);
    }
    let rmssd = 0;
    let pnn50 = 0;
    if (rrMs.length > 1) {
      const diffs = [];
      for (let i = 1; i < rrMs.length; i++) {
        const d = rrMs[i] - rrMs[i - 1];
        diffs.push(d);
      }
      if (diffs.length > 0) {
        let sqSum = 0;
        let countNN50 = 0;
        for (let i = 0; i < diffs.length; i++) {
          const d = diffs[i];
          sqSum += d * d;
          if (Math.abs(d) > 50) countNN50 += 1;
        }
        rmssd = Math.sqrt(sqSum / diffs.length);
        pnn50 = (countNN50 * 100) / diffs.length;
      }
    }
    const hrSeries = rrMs.filter(v => v > 0).map(v => 60000 / v);
    let hrMean = 0;
    let hrStd = 0;
    if (hrSeries.length > 0) {
      let s = 0;
      for (let i = 0; i < hrSeries.length; i++) s += hrSeries[i];
      hrMean = s / hrSeries.length;
      if (hrSeries.length > 1) {
        hrStd = getStd(hrSeries);
      }
    }
    let hrChangeRate = 0;
    if (hrMean > 0 && hrStd > 0) {
      hrChangeRate = hrStd * 100 / hrMean;
    }

    // Downsample if too large (target ~20k points for smooth rendering)
    const { data: sampledData, stride } = downsampleSignal(data, 20000);

    // Generate time array with corrected sample rate
    // effective fs = sampleRate / stride
    const effectiveSR = sampleRate / stride;
    const times = sampledData.map((_, i) => i / effectiveSR);

    return {
      voltage: sampledData,
      time: times,
      sampleRate,
      metrics: {
        n_peaks_ECG: peaks.length,
        Mean_RR_ms_ECG: meanRR,
        SDNN_ms_ECG: sdnn,
        RMSSD_ms_ECG: rmssd,
        pNN50_pct_ECG: pnn50,
        HR_Mean_ECG: hrMean,
        HR_Std_ECG: hrStd,
        HR_Change_Rate_ECG: hrChangeRate
      }
    };

  } catch (e) {
    console.error('ECG Analysis Error:', e);
    throw e;
  }
}

function analyzeEMG(filePath) {
  try {
    if (!fs.existsSync(filePath)) throw new Error('File not found');
    const content = fs.readFileSync(filePath, 'utf-8');
    const rows = parseDataFile(content, 4);
    const chArm = [];
    const chNeck = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.length > 0) chArm.push(r[0]);
      if (r.length > 1) chNeck.push(r[1]);
    }
    if (chArm.length === 0) throw new Error('No valid EMG data found');
    const sampleRate = 1000;
    const { mav: armMav, rms: armRms, iemg: armIemg, maxAmp: armMax } = computeEmgTimeFeatures(chArm);
    const { mdf: armMdf, mpf: armMpf } = computeEmgFreqFeatures(chArm, sampleRate);
    let neckMav = null;
    let neckRms = null;
    let neckIemg = null;
    let neckMax = null;
    let neckMdf = null;
    let neckMpf = null;
    if (chNeck.length > 0) {
      let hasNonZero = false;
      for (let i = 0; i < chNeck.length; i++) {
        if (chNeck[i] !== 0) {
          hasNonZero = true;
          break;
        }
      }
      if (hasNonZero) {
        const t = computeEmgTimeFeatures(chNeck);
        const f = computeEmgFreqFeatures(chNeck, sampleRate);
        neckMav = t.mav;
        neckRms = t.rms;
        neckIemg = t.iemg;
        neckMax = t.maxAmp;
        neckMdf = f.mdf;
        neckMpf = f.mpf;
      }
    }
    const { data: sampledData, stride } = downsampleSignal(chArm, 20000);
    const effectiveSR = sampleRate / stride;
    const times = sampledData.map((_, i) => i / effectiveSR);
    return {
      voltage: sampledData,
      times,
      sampleRate,
      metrics: {
        Arm_MAV: armMav,
        Arm_MDF: armMdf,
        Arm_MPF: armMpf,
        Arm_RMS: armRms,
        Arm_iEMG: armIemg,
        Arm_Max_Amp: armMax,
        Neck_MAV: neckMav,
        Neck_MDF: neckMdf,
        Neck_MPF: neckMpf,
        Neck_RMS: neckRms,
        Neck_iEMG: neckIemg,
        Neck_Max_Amp: neckMax
      }
    };
  } catch (e) {
    console.error('EMG Analysis Error:', e);
    throw e;
  }
}

/**
 * Helper to apply rotation by quaternion [x, y, z, w] to vector [0, 0, 1]
 * Returns rotated vector [vx, vy, vz]
 */
function getForwardVector(qx, qy, qz, qw) {
    // Vector v = (0, 0, 1)
    // Formula for rotating v by q:
    // x = 2(xz + wy)
    // y = 2(yz - wx)
    // z = 1 - 2(x^2 + y^2)
    
    const vx = 2 * (qx * qz + qw * qy);
    const vy = 2 * (qy * qz - qw * qx);
    const vz = 1 - 2 * (qx * qx + qy * qy);
    
    return [vx, vy, vz];
}

/**
 * 2D Gaussian Blur on a flattened grid
 */
function gaussianBlur(grid, width, height, sigma = 1) {
    // Simple 3-pass box blur or true gaussian? 
    // Implementing a separable gaussian kernel is better.
    // Kernel radius ~ 3*sigma
    const radius = Math.ceil(3 * sigma);
    const kernelSize = 2 * radius + 1;
    const kernel = new Float32Array(kernelSize);
    const sigma2 = sigma * sigma;
    const factor = 1 / (Math.sqrt(2 * Math.PI) * sigma);
    let sum = 0;
    
    for (let i = 0; i < kernelSize; i++) {
        const x = i - radius;
        const val = factor * Math.exp(-(x * x) / (2 * sigma2));
        kernel[i] = val;
        sum += val;
    }
    // Normalize kernel
    for (let i = 0; i < kernelSize; i++) kernel[i] /= sum;

    const tempGrid = new Float32Array(grid.length);
    const resultGrid = new Float32Array(grid.length);

    // Horizontal pass
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let val = 0;
            for (let k = 0; k < kernelSize; k++) {
                const kx = x + (k - radius);
                // Clamp edge
                const px = Math.max(0, Math.min(width - 1, kx));
                val += grid[y * width + px] * kernel[k];
            }
            tempGrid[y * width + x] = val;
        }
    }

    // Vertical pass
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            let val = 0;
            for (let k = 0; k < kernelSize; k++) {
                const ky = y + (k - radius);
                // Clamp edge
                const py = Math.max(0, Math.min(height - 1, ky));
                val += tempGrid[py * width + x] * kernel[k];
            }
            resultGrid[y * width + x] = val;
        }
    }
    
    return resultGrid;
}

function analyzeEye(filePath) {
    try {
        if (!fs.existsSync(filePath)) throw new Error('File not found');
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.trim().split('\n');
        
        if (lines.length < 2) throw new Error('No valid Eye data found');

        // Parse header to find column indices
        const headerParts = lines[0].trim().split(/[,\s]+/);
        const colMap = {};
        headerParts.forEach((h, i) => colMap[h] = i);

        const reqCols = ['L_rot_x', 'L_rot_y', 'L_rot_z', 'L_rot_w', 'R_rot_x', 'R_rot_y', 'R_rot_z', 'R_rot_w'];
        const missing = reqCols.filter(c => !(c in colMap));
        if (missing.length > 0) {
            // Try fallback indices if header is missing or different?
            // User provided specific names, assume they exist.
            // If strictly missing, maybe throw or return empty.
            // Let's assume standard index if not found (risky but better than crash if just naming mismatch)
            // But user said "timestamp L_pos_x..." 
            // Let's rely on finding them.
             throw new Error(`Missing columns: ${missing.join(', ')}`);
        }

        let timeIdx = -1;
        let timeScaleMs = 1;
        Object.keys(colMap).forEach(name => {
            const lower = name.toLowerCase();
            if (timeIdx === -1 && (lower.includes('time') || lower.includes('timestamp'))) {
                timeIdx = colMap[name];
            }
        });

        let lPupilIdx = -1;
        let rPupilIdx = -1;
        Object.keys(colMap).forEach(name => {
            const lower = name.toLowerCase();
            if (lPupilIdx === -1 && lower.includes('pupil') && (lower.includes('l_') || lower.includes('left'))) {
                lPupilIdx = colMap[name];
            }
            if (rPupilIdx === -1 && lower.includes('pupil') && (lower.includes('r_') || lower.includes('right'))) {
                rPupilIdx = colMap[name];
            }
        });

        let lOpenIdx = -1;
        let lSqueezeIdx = -1;
        Object.keys(colMap).forEach(name => {
            const lower = name.toLowerCase();
            if (lOpenIdx === -1 && lower.includes('open') && (lower.includes('l_') || lower.includes('left'))) {
                lOpenIdx = colMap[name];
            }
            if (lSqueezeIdx === -1 && lower.includes('squeeze') && (lower.includes('l_') || lower.includes('left'))) {
                lSqueezeIdx = colMap[name];
            }
        });

        let blinkIdx = -1;
        Object.keys(colMap).forEach(name => {
            if (blinkIdx === -1 && /blink/i.test(name)) {
                blinkIdx = colMap[name];
            }
        });

        const binsYaw = 360;
        const binsPitch = 180;
        const heatmap = new Float32Array(binsYaw * binsPitch);

        let validSamples = 0;
        const yawArr = [];
        const pitchArr = [];
        const timeArr = [];
        const pupilLArr = [];
        const pupilRArr = [];
        const openLArr = [];
        const squeezeLArr = [];
        const blinkArr = [];

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            const parts = line.split(/[,\s]+/);
            
            const getVal = (name) => {
                const val = parseFloat(parts[colMap[name]]);
                return isNaN(val) ? 0 : val;
            };

            const l_x = getVal('L_rot_x'), l_y = getVal('L_rot_y'), l_z = getVal('L_rot_z'), l_w = getVal('L_rot_w');
            const r_x = getVal('R_rot_x'), r_y = getVal('R_rot_y'), r_z = getVal('R_rot_z'), r_w = getVal('R_rot_w');

            const vL = getForwardVector(l_x, l_y, l_z, l_w);
            const vR = getForwardVector(r_x, r_y, r_z, r_w);

            let ax = (vL[0] + vR[0]) / 2;
            let ay = (vL[1] + vR[1]) / 2;
            let az = (vL[2] + vR[2]) / 2;

            const mag = Math.sqrt(ax*ax + ay*ay + az*az);
            if (mag < 1e-6) continue; // Degenerate vector
            ax /= mag; ay /= mag; az /= mag;

            const yaw = Math.atan2(ax, az) * (180 / Math.PI);
            const pitch = Math.asin(Math.max(-1, Math.min(1, ay))) * (180 / Math.PI);

            yawArr.push(yaw);
            pitchArr.push(pitch);

            let t = null;
            if (timeIdx >= 0 && timeIdx < parts.length) {
                const tv = parseFloat(parts[timeIdx]);
                if (!isNaN(tv)) t = tv;
            }
            timeArr.push(t);

        if (lPupilIdx >= 0 && lPupilIdx < parts.length) {
                const pv = parseFloat(parts[lPupilIdx]);
                if (!isNaN(pv)) pupilLArr.push(pv);
            }
            if (rPupilIdx >= 0 && rPupilIdx < parts.length) {
                const pv = parseFloat(parts[rPupilIdx]);
                if (!isNaN(pv)) pupilRArr.push(pv);
            }
            let ovSample = null;
            let svSample = null;
            if (lOpenIdx >= 0 && lOpenIdx < parts.length) {
                const ov = parseFloat(parts[lOpenIdx]);
                if (!isNaN(ov)) {
                    openLArr.push(ov);
                    ovSample = ov;
                }
            }
            if (lSqueezeIdx >= 0 && lSqueezeIdx < parts.length) {
                const sv = parseFloat(parts[lSqueezeIdx]);
                if (!isNaN(sv)) {
                    squeezeLArr.push(sv);
                    svSample = sv;
                }
            }
            let blinkFlag = 0;
            if (blinkIdx >= 0 && blinkIdx < parts.length) {
                const bv = parseFloat(parts[blinkIdx]);
                blinkFlag = isNaN(bv) ? 0 : (bv > 0.2 ? 1 : 0);
            } else {
                if (ovSample !== null && ovSample < 0.7) {
                    blinkFlag = 1;
                }
                if (svSample !== null && svSample > 0.3) {
                    blinkFlag = 1;
                }
            }
            blinkArr.push(blinkFlag);

            let xIdx = Math.floor(yaw + 180); 
            let yIdx = Math.floor(pitch + 90);

            // Clamp
            if (xIdx >= binsYaw) xIdx = binsYaw - 1;
            if (xIdx < 0) xIdx = 0;
            if (yIdx >= binsPitch) yIdx = binsPitch - 1;
            if (yIdx < 0) yIdx = 0;

            heatmap[yIdx * binsYaw + xIdx]++;
            validSamples++;
        }

        if (validSamples === 0) throw new Error('No valid gaze data computed');

        const smoothedHeatmap = gaussianBlur(heatmap, binsYaw, binsPitch, 4); // Use 4 to be safe/faster than 8

        const chartData = [];
        for (let y = 0; y < binsPitch; y++) {
            for (let x = 0; x < binsYaw; x++) {
                const val = smoothedHeatmap[y * binsYaw + x];
                if (val > 0.01) { // Threshold to reduce data
                    // x maps to -180 + x
                    // y maps to -90 + y
                    chartData.push([x - 180, y - 90, val]);
                }
            }
        }

        let yawStd = 0;
        let pitchStd = 0;
        if (yawArr.length > 1) {
            yawStd = getStd(yawArr);
            pitchStd = getStd(pitchArr);
        }

        let avgPupilL = null;
        let avgPupilR = null;
        if (pupilLArr.length > 0) {
            let s = 0;
            for (let i = 0; i < pupilLArr.length; i++) s += pupilLArr[i];
            avgPupilL = s / pupilLArr.length;
        }
        if (pupilRArr.length > 0) {
            let s = 0;
            for (let i = 0; i < pupilRArr.length; i++) s += pupilRArr[i];
            avgPupilR = s / pupilRArr.length;
        }

        let avgOpenL = null;
        let avgSqueezeL = null;
        if (openLArr.length > 0) {
            let s = 0;
            for (let i = 0; i < openLArr.length; i++) s += openLArr[i];
            avgOpenL = s / openLArr.length;
        }
        if (squeezeLArr.length > 0) {
            let s = 0;
            for (let i = 0; i < squeezeLArr.length; i++) s += squeezeLArr[i];
            avgSqueezeL = s / squeezeLArr.length;
        }

        let dtMs = null;
        if (timeIdx >= 0 && timeArr.length > 1) {
            let first = null;
            let last = null;
            for (let i = 0; i < timeArr.length; i++) {
                if (timeArr[i] != null) {
                    if (first == null) first = timeArr[i];
                    last = timeArr[i];
                }
            }
            if (first != null && last != null && last > first) {
                const total = last - first;
                const steps = timeArr.length - 1;
                dtMs = total / steps;
                if (total > 0 && total < 1e6) {
                    timeScaleMs = 1000;
                } else {
                    timeScaleMs = 1;
                }
            }
        }
        if (dtMs == null) {
            dtMs = 1000 / 120;
            timeScaleMs = 1;
        }

        const nSamples = blinkArr.length;
        let blinkCount = 0;
        let shortBlinkCount = 0;
        let blinkDurTotalMs = 0;
        let inBlink = false;
        let blinkLen = 0;
        for (let i = 0; i < nSamples; i++) {
            const b = blinkArr[i] === 1;
            if (b) {
                blinkLen += 1;
                if (!inBlink) {
                    inBlink = true;
                }
            } else if (inBlink) {
                const durMs = blinkLen * dtMs;
                blinkCount += 1;
                blinkDurTotalMs += durMs;
                if (durMs <= 100) {
                    shortBlinkCount += 1;
                }
                inBlink = false;
                blinkLen = 0;
            }
        }
        if (inBlink && blinkLen > 0) {
            const durMs = blinkLen * dtMs;
            blinkCount += 1;
            blinkDurTotalMs += durMs;
            if (durMs <= 100) {
                shortBlinkCount += 1;
            }
        }

        let totalTimeSec = nSamples * dtMs / 1000;
        let blinkFreq = 0;
        let avgBlinkDurMs = null;
        if (blinkCount > 0 && totalTimeSec > 0) {
            blinkFreq = blinkCount / totalTimeSec;
            avgBlinkDurMs = blinkDurTotalMs / blinkCount;
        }
        let samplingRateEst = null;
        if (totalTimeSec > 0 && nSamples > 1) {
            samplingRateEst = nSamples / totalTimeSec;
        }

        const nYaw = yawArr.length;
        const ampArr = [];
        for (let i = 1; i < nYaw; i++) {
            const dy = yawArr[i] - yawArr[i - 1];
            const dp = pitchArr[i] - pitchArr[i - 1];
            const a = Math.sqrt(dy * dy + dp * dp);
            ampArr.push(a);
        }

        let fixationCount = 0;
        let fixationDurTotalMs = 0;
        let saccadeCount = 0;
        let saccAmpTotal = 0;
        let saccVelTotal = 0;
        const fixThresh = 1;
        const saccThresh = 2;
        let inFix = false;
        let fixLen = 0;
        let inSacc = false;
        let saccLen = 0;
        let saccAmpSum = 0;
        for (let i = 0; i < ampArr.length; i++) {
            const a = ampArr[i];
            const isFix = a < fixThresh;
            const isSacc = a >= saccThresh;
            if (isFix) {
                fixLen += 1;
                if (!inFix) inFix = true;
            } else if (inFix) {
                fixationCount += 1;
                fixationDurTotalMs += fixLen * dtMs;
                inFix = false;
                fixLen = 0;
            }
            if (isSacc) {
                saccLen += 1;
                saccAmpSum += a;
                if (!inSacc) inSacc = true;
            } else if (inSacc) {
                saccadeCount += 1;
                // Accumulate total amplitude (path length) for this saccade
                saccAmpTotal += saccAmpSum;
                // Calculate velocity for this saccade (deg/s)
                const durSec = (saccLen * dtMs) / 1000;
                if (durSec > 0) {
                    saccVelTotal += saccAmpSum / durSec;
                }
                inSacc = false;
                saccLen = 0;
                saccAmpSum = 0;
            }
        }
        if (inFix && fixLen > 0) {
            fixationCount += 1;
            fixationDurTotalMs += fixLen * dtMs;
        }
        if (inSacc && saccLen > 0) {
            saccadeCount += 1;
            saccAmpTotal += saccAmpSum;
            const durSec = (saccLen * dtMs) / 1000;
            if (durSec > 0) {
                saccVelTotal += saccAmpSum / durSec;
            }
        }

        let avgFixDurMs = null;
        if (fixationCount > 0) {
            avgFixDurMs = fixationDurTotalMs / fixationCount;
        }
        let fixationFreq = 0;
        if (fixationCount > 0 && totalTimeSec > 0) {
            fixationFreq = fixationCount / totalTimeSec;
        }
        
        let avgSaccAmp = null;
        let avgSaccVel = null;
        let saccadeRate = 0;
        if (saccadeCount > 0) {
            avgSaccAmp = saccAmpTotal / saccadeCount;
            avgSaccVel = saccVelTotal / saccadeCount;
            if (totalTimeSec > 0) {
                saccadeRate = saccadeCount / totalTimeSec;
            }
        }
        
        // Calculate average pupil diameter (L+R)/2
        let avgPupilDiam = null;
        if (avgPupilL !== null || avgPupilR !== null) {
            if (avgPupilL !== null && avgPupilR !== null) {
                avgPupilDiam = (avgPupilL + avgPupilR) / 2;
            } else {
                avgPupilDiam = avgPupilL !== null ? avgPupilL : avgPupilR;
            }
        }

        return {
            heatmapData: chartData,
            minX: -180, maxX: 180,
            minY: -90, maxY: 90,
            metrics: {
                duration_sec_Eye: totalTimeSec,
                sampling_rate_est_Eye: samplingRateEst,
                
                // Mapped to renderer expectations
                blink_count_Eye: blinkCount,
                blink_rate_Hz_Eye: blinkFreq, 
                blink_dur_ms_Eye: avgBlinkDurMs,
                
                fixation_count_Eye: fixationCount,
                fixation_rate_Hz_Eye: fixationFreq,
                avg_fixation_dur_ms_Eye: avgFixDurMs,
                
                saccade_count_Eye: saccadeCount,
                saccade_rate_Hz_Eye: saccadeRate,
                avg_saccade_amp_deg_Eye: avgSaccAmp,
                avg_saccade_vel_deg_s_Eye: avgSaccVel,
                
                avg_pupil_diam_mm_Eye: avgPupilDiam,
                
                // Detailed/Original metrics
                short_blink_count_Eye: shortBlinkCount,
                avg_pupil_L_Eye: avgPupilL,
                avg_pupil_R_Eye: avgPupilR,
                L_openness: avgOpenL,
                L_squeeze: avgSqueezeL,
                gaze_yaw_std_Eye: yawStd,
                gaze_pitch_std_Eye: pitchStd
            }
        };

    } catch (e) {
        console.error('Eye Analysis Error:', e);
        throw e;
    }
}

module.exports = { analyzeECG, analyzeEMG, analyzeEye };
