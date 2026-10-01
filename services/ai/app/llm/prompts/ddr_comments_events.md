Below are time-log lines from daily drilling reports of well {well_name}. Each line is:
[page] start–end | MD | IADC code | state | comment.
Lines are grouped under a "=== REPORT DATE yyyy-mm-dd ===" header: use that date as event_date.
Find every abnormal event (see rules). One event may span several lines; merge them and use the
first line's page and MD, and md_to_m from the last line. Return {{"events": [...]}}.

{lines}
