import { formatDistanceToNow } from 'date-fns';

export function fmtDepth(m) {
  return m == null ? '-' : `${Number(m).toFixed(1)} m`;
}

export function fmtSG(sg) {
  return sg == null ? '-' : `${Number(sg).toFixed(2)} SG`;
}

export function fmtVolume(m3) {
  return m3 == null ? '-' : `${Number(m3).toFixed(1)} m³`;
}

export function fmtTorque(knm) {
  return knm == null ? '-' : `${Number(knm).toFixed(1)} kN·m`;
}

export function fmtDistance(m) {
  if (m == null) return '-';
  const num = Number(m);
  return num >= 1000 ? `${(num / 1000).toFixed(1)} km` : `${num.toFixed(0)} m`;
}

export function fmtDuration(h) {
  return h == null ? '-' : `${Number(h).toFixed(1)} h`;
}

export function fmtTimeAgo(isoString) {
  if (!isoString) return '-';
  return formatDistanceToNow(new Date(isoString), { addSuffix: true });
}
