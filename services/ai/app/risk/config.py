"""Risk and alert constants (contract §11). Initial proposals: tune after validation and
record any change in the contract. Each constant names the section it comes from."""

# --- §11.1 score bands (0-100). Boundaries: score <= 20 low; 20 < s <= 40 moderate; ...
BAND_LOW_MAX = 20.0
BAND_MODERATE_MAX = 40.0
BAND_ELEVATED_MAX = 60.0
BAND_HIGH_MAX = 80.0

# --- §11.2 look-ahead grid
LOOKAHEAD_MIN_M = 50.0  # alerts only for intervals starting at or beyond bit + this
LOOKAHEAD_MAX_M = 300.0
INTERVAL_M = 25.0
LOOKAHEAD_INTERVALS = int(LOOKAHEAD_MAX_M // INTERVAL_M)  # k = 0..11 -> bit .. bit + 300

# --- §11.3 L1 offset look-ahead
RADIUS_M = 10000.0  # offsets_within radius
L1_DEPTH_DECAY_M = 3000.0  # w = exp(-depth_distance_m / this)
L1_HIT_REL_DEPTH_TOL = 0.10  # |event relative_depth - interval relative_depth|
L1_HIT_MD_TOL_M = 25.0  # used when a relative depth is unknown
L1_PRIOR_HIT = 0.5  # l1 = (sum(w*hit) + PRIOR_HIT) / (sum(w) + PRIOR_WEIGHT)
L1_PRIOR_WEIGHT = 1.0
L1_MAX_REASONS = 5  # top offset events by weight kept as reasons (BE-14 spec)

# --- §11.5 unreviewed events count with this weight; rejected events never count
UNREVIEWED_EVENT_WEIGHT = 0.5

# --- §11.4 L3 detectors
CIRCULATION_MIN_FLOW_LPM = 200.0  # BE-15: detectors need circulation (flow_in above this)
DETECTOR_WINDOW_SAMPLES = 600  # rolling window kept per wellbore (BE-15)
DETECTOR_WINDOW_M = 300.0

LOSSES_FLOW_RATIO = 0.90  # flow_out < flow_in * ratio ...
LOSSES_DURATION_S = 120.0  # ... for at least this long
LOSSES_PIT_FALL_M3 = 1.0  # or pit volume falls this much ...
LOSSES_PIT_WINDOW_S = 600.0  # ... in this long, while circulating
LOSSES_FLOOR = 65

TOTAL_LOSSES_FLOW_RATIO = 0.50
TOTAL_LOSSES_DURATION_S = 30.0
TOTAL_LOSSES_FLOOR = 85

KICK_PIT_GAIN_M3 = 1.6  # about 10 bbl ...
KICK_PIT_WINDOW_S = 600.0  # ... in 10 min
KICK_FLOW_RATIO = 1.10  # or flow_out > flow_in * ratio ...
KICK_FLOW_DURATION_S = 60.0  # ... for at least this long
KICK_FLOOR = 85

OVERPRESSURE_DXC_FALL_FRAC = 0.15  # dxc falls this fraction ...
OVERPRESSURE_WINDOW_M = 50.0  # ... over this depth ...
OVERPRESSURE_TREND_M = 200.0  # ... below its trend over this depth, with gas rising
OVERPRESSURE_FLOOR = 65

STUCK_OVERPULL_FRAC = 0.20  # hookload above the moving average by this fraction ...
STUCK_MA_WINDOW_M = 30.0  # ... (moving average over this depth) ...
STUCK_CONSECUTIVE_CONNECTIONS = 3  # ... on this many consecutive connections
STUCK_TORQUE_Z = 3.0  # or torque z-score above this ...
STUCK_ROP_DROP_FRAC = 0.50  # ... with ROP down by this fraction
STUCK_FLOOR = 65

TORQUE_Z_THRESHOLD = 3.5  # rolling z-score ...
TORQUE_WINDOW_SAMPLES = 60  # ... over this many samples
TORQUE_FLOOR = 65

# --- §11.5 fusion, confidence, capping
W_L1 = 0.5  # renormalised over the layers that are not null
W_L2 = 0.3
W_L3 = 0.2
CONF_HIGH_MIN_OFFSETS = 3
CONF_HIGH_MIN_EVENT_CONF = 0.8
CONF_MEDIUM_MIN_OFFSETS = 2
CONF_MEDIUM_MIN_EVENT_CONF = 0.6

# --- §11.7 timings and keys
STREAM_STALE_S = 10.0
STREAM_LOST_S = 30.0
ESCALATE_CRITICAL_S = 300.0
ESCALATE_WARNING_S = 900.0
RETRIGGER_HYSTERESIS = 15.0  # score points above the band threshold
DEDUP_ZONE_M = 50.0  # zone_start = floor(zone_md_from_m / this) * this
ENGINE_TICK_S = 5.0
