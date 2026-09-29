import wellsData from './fixtures/wells.json';
import streamStateData from './fixtures/stream_state.json';
import alertsData from './fixtures/alerts.json';
import riskScoresData from './fixtures/risk_scores.json';

class MockDatabase {
  constructor() {
    this.wells = [...wellsData];
    this.stream_state = [...streamStateData];
    this.alerts = [...alertsData];
    this.risk_scores = [...riskScoresData];
    // Simple event bus for realtime
    this.emitter = new EventTarget();
  }

  emitChange(table, record) {
    this.emitter.dispatchEvent(new CustomEvent(`change:${table}`, { detail: record }));
  }

  getWell(id) {
    return this.wells.find(w => w.wellbore_id === id);
  }

  getAlert(id) {
    return this.alerts.find(a => a.id === id);
  }

  updateAlert(id, updates) {
    const idx = this.alerts.findIndex(a => a.id === id);
    if (idx > -1) {
      this.alerts[idx] = { ...this.alerts[idx], ...updates };
      this.emitChange('alerts', this.alerts[idx]);
      return this.alerts[idx];
    }
    return null;
  }
}

export const db = new MockDatabase();
