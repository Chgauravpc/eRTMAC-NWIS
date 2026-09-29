// Shared deterministic ids for the mock layer. Every fixture and handler must derive ids from here
// (or from fixtures/wells.json) so screens agree on which well is which. No component may import this.
import wells from './fixtures/wells.json';

export const MOCK_WELLS = wells;
export const ACTIVE_WELL = wells.find((w) => w.status === 'drilling'); // SYN-DLJ-03
export const ACTIVE_WELLBORE_ID = ACTIVE_WELL.wellbore_id;
export const ACTIVE_WELL_ID = ACTIVE_WELL.well_id;
export const wellByWellbore = (id) => wells.find((w) => w.wellbore_id === id);
export const MOCK_USER_ID = '00000000-0000-4000-a000-000000000001';
