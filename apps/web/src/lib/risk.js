export const BAND_META = {
  low: { 
    label: 'Low',
    color: 'bg-green-100 text-green-800 border-green-200',
    severity: 'none',
    meaning: 'Normal operations. No specific mitigation required.'
  },
  moderate: {
    label: 'Moderate',
    color: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    severity: 'info',
    meaning: 'Slight risk increase. Monitor parameters closely.'
  },
  elevated: {
    label: 'Elevated',
    color: 'bg-amber-100 text-amber-800 border-amber-200',
    severity: 'watch',
    meaning: 'Significant risk. Review mitigation plans.'
  },
  high: {
    label: 'High',
    color: 'bg-orange-100 text-orange-800 border-orange-200',
    severity: 'warning',
    meaning: 'High probability of occurrence. Implement mitigations.'
  },
  critical: {
    label: 'Critical',
    color: 'bg-red-100 text-red-800 border-red-200',
    severity: 'critical',
    meaning: 'Imminent danger. Stop drilling and evaluate.'
  }
};

export function bandFor(score) {
  if (score == null) return null;
  if (score <= 20) return 'low';
  if (score <= 40) return 'moderate';
  if (score <= 60) return 'elevated';
  if (score <= 80) return 'high';
  return 'critical';
}

export function severityFor(band) {
  return BAND_META[band]?.severity || 'none';
}
