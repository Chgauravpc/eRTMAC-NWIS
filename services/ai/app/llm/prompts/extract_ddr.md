The text below is a daily drilling report (DDR). Extract, as the schema allows:
- well_name, report_date and the doc_type "ddr".
- events: every abnormal occurrence in the time log, remarks and summaries (losses, kicks, stuck
  pipe, tight hole, pack-off, fishing, equipment failures, cement problems). Fill npt_h and
  volume_m3 only when stated; keep event_date = the report date.
- mud_records: one per mud-property block (MD, mud type, MW, PV, YP, ECD).
- time_log: one item per time-log row (start/end, hours, MD, phase, IADC code, state, comment).
- survey_stations: only if a survey table is present.
Leave out anything that is not written in the text.
