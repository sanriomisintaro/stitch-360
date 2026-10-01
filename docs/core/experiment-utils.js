/** Pure helpers used by the Sprint 3 batch experiment. */

export function parseGammaList(text) {
  const values = String(text)
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(Number);
  if (values.length === 0 || values.some((v) => !Number.isFinite(v) || v <= 0 || v > 20)) {
    throw new RangeError('Gamma list must contain positive numeric values <= 20');
  }
  return [...new Set(values)].sort((a, b) => a - b);
}

export function mean(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : NaN;
}

export function sampleSd(values) {
  const finite = values.filter(Number.isFinite);
  if (finite.length < 2) return 0;
  const m = mean(finite);
  const sum = finite.reduce((acc, v) => acc + (v - m) ** 2, 0);
  return Math.sqrt(sum / (finite.length - 1));
}

export function median(values) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return NaN;
  const mid = Math.floor(finite.length / 2);
  return finite.length % 2 ? finite[mid] : (finite[mid - 1] + finite[mid]) / 2;
}

export function summarizeByGamma(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.gamma)) groups.set(row.gamma, []);
    groups.get(row.gamma).push(row);
  }
  const metricKeys = [
    'psnr', 'ssim', 'mae',
    'seamPsnr', 'seamSsim', 'seamMae', 'seamGradientError',
    'runtimeMs',
  ];
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([gamma, items]) => {
    const out = { gamma, n: items.length };
    for (const key of metricKeys) {
      const values = items.map((r) => Number(r[key]));
      out[`${key}Mean`] = mean(values);
      out[`${key}Sd`] = sampleSd(values);
    }
    return out;
  });
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  let text = Number.isFinite(value) ? String(value) : String(value);
  if (/[",\n\r]/.test(text)) text = `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function rowsToCsv(rows, columns = null) {
  if (!rows.length) return '';
  const keys = columns || Object.keys(rows[0]);
  const lines = [keys.map(csvEscape).join(',')];
  for (const row of rows) lines.push(keys.map((k) => csvEscape(row[k])).join(','));
  return lines.join('\n');
}
