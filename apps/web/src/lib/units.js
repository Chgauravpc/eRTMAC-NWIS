import { formatDistanceToNow } from 'date-fns';

// SI values from the contract (section 4) are formatted here; components never convert units.
const finite = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

/** 2395 -> "2395.0 m" */
export function fmtDepth(m) {
  return finite(m) ? `${Number(m).toFixed(1)} m` : '-';
}

/** 1.185 -> "1.19 SG" */
export function fmtSG(sg) {
  return finite(sg) ? `${Number(sg).toFixed(2)} SG` : '-';
}

/** 42 -> "42.0 m³" */
export function fmtVolume(m3) {
  return finite(m3) ? `${Number(m3).toFixed(1)} m³` : '-';
}

/** 15 -> "15.0 kN·m" */
export function fmtTorque(knm) {
  return finite(knm) ? `${Number(knm).toFixed(1)} kN·m` : '-';
}

/** Metres below 1,000, kilometres above: 500 -> "500 m", 1500 -> "1.5 km" */
export function fmtDistance(m) {
  if (!finite(m)) return '-';
  const num = Number(m);
  return num >= 1000 ? `${(num / 1000).toFixed(1)} km` : `${num.toFixed(0)} m`;
}

/** 3.5 -> "3.5 h" */
export function fmtDuration(h) {
  return finite(h) ? `${Number(h).toFixed(1)} h` : '-';
}

/** ISO timestamp -> "5 minutes ago" */
export function fmtTimeAgo(isoString) {
  if (!isoString) return '-';
  const d = new Date(isoString);
  return Number.isNaN(d.getTime()) ? '-' : formatDistanceToNow(d, { addSuffix: true });
}
