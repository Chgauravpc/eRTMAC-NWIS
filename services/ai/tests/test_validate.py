"""BE-08: validation rules and confidence (contract §10)."""

from datetime import date

import pytest

from app.ingest import validate as rules
from app.models.enums import ReviewStatus

PAGE = "Obs. partial losses @ 2395 m 15 m3/hr, pumped LCM pill. Losses cured after 2 h."
SNIPPET = "partial losses @ 2395 m 15 m3/hr, pumped LCM pill"
TODAY = date(2026, 10, 1)


def check(values=None, **overrides):
    kwargs = dict(
        llm_confidence=0.95, snippet=SNIPPET, page_text=PAGE, ocr_confidence=None, td_md_m=3600.0, today=TODAY
    )
    kwargs.update(overrides)
    return rules.check_item(values or {}, **kwargs)


# ---------------------------------------------------------------- one case per rule


def test_clean_item_is_auto_approved():
    verdict = check({"md_from_m": 2395.0, "event_date": date(2019, 3, 12)})
    assert verdict.review_status == ReviewStatus.AUTO_APPROVED
    assert verdict.confidence == 0.95 and verdict.reasons == () and verdict.reason is None


def test_rule_depth_gt_td_allows_50_m_of_slack():
    assert check({"md_from_m": 3650.0}).failed_rules == ()  # td + 50 is still fine
    verdict = check({"md_from_m": 3650.1})
    assert verdict.failed_rules == ("failed_rule:depth_gt_td",)


def test_rule_depth_gt_td_is_skipped_when_td_is_unknown():
    assert check({"md_from_m": 99999.0}, td_md_m=None).failed_rules == ()


def test_rule_depth_gt_td_applies_to_every_depth_field():
    for name in ("md_from_m", "md_to_m", "top_md_m", "md_m", "shoe_md_m", "toc_md_m"):
        assert "failed_rule:depth_gt_td" in check({name: 4000.0}).failed_rules, name


def test_rule_depth_negative():
    assert check({"md_from_m": -1.0}).failed_rules == ("failed_rule:depth_negative",)
    assert check({"md_from_m": 0.0}).failed_rules == ()


def test_rule_formation_order():
    verdict = check({}, formation_order_ok=False)
    assert verdict.failed_rules == ("failed_rule:formation_order",)


@pytest.mark.parametrize(
    "when, fails",
    [(date(1949, 12, 31), True), (date(1950, 1, 1), False), (TODAY, False), (date(2026, 10, 2), True)],
)
def test_rule_date_out_of_range(when, fails):
    verdict = check({"event_date": when})
    assert (verdict.failed_rules == ("failed_rule:date_out_of_range",)) is fails


@pytest.mark.parametrize("mw, fails", [(0.79, True), (0.8, False), (1.18, False), (2.4, False), (2.41, True)])
def test_rule_mw_out_of_range(mw, fails):
    assert (check({"mw_sg": mw}).failed_rules == ("failed_rule:mw_out_of_range",)) is fails


def test_rule_snippet_not_found():
    verdict = check(snippet="completely different words that are nowhere on this page at all")
    assert verdict.failed_rules == ("snippet_not_found",)


def test_snippet_tolerates_ocr_noise_and_spacing():
    noisy = "partial  Iosses @ 2395 rn  15 m3/hr, pumped LCM pi11"
    assert rules.snippet_found(noisy, PAGE)


def test_missing_snippet_counts_as_not_found_but_unknown_page_skips_the_rule():
    assert check(snippet=None).failed_rules == ("snippet_not_found",)
    assert check(snippet=None, page_text=None).failed_rules == ()  # page unknown: cannot check
    assert check(snippet="x", check_snippet=False).failed_rules == ()


# ---------------------------------------------------------------- confidence


def test_confidence_is_the_min_of_llm_and_page_ocr():
    assert check(llm_confidence=0.95, ocr_confidence=0.9).confidence == 0.9
    assert check(llm_confidence=0.7, ocr_confidence=0.99).confidence == 0.7


def test_each_failed_rule_costs_0_3_and_failures_are_capped_at_0_5():
    one = check({"mw_sg": 3.0}, llm_confidence=0.9)
    assert one.confidence == 0.5  # 0.9 - 0.3 = 0.6, capped at 0.5
    two = check({"mw_sg": 3.0, "md_from_m": -5.0}, llm_confidence=0.9)
    assert two.confidence == 0.3  # 0.9 - 0.6
    assert one.review_status == two.review_status == ReviewStatus.PENDING


def test_confidence_never_drops_below_the_floor():
    verdict = check({"mw_sg": 3.0, "md_from_m": -5.0, "event_date": date(1900, 1, 1)}, llm_confidence=0.4)
    assert verdict.confidence == rules.CONFIDENCE_FLOOR


@pytest.mark.parametrize("confidence, status", [
    (0.85, ReviewStatus.AUTO_APPROVED), (0.99, ReviewStatus.AUTO_APPROVED),
    (0.8499, ReviewStatus.PENDING), (0.3, ReviewStatus.PENDING),
])
def test_auto_approve_threshold(confidence, status):
    assert check(llm_confidence=confidence).review_status == status


def test_unknown_formation_is_never_auto_approved_and_is_not_penalised_as_a_rule():
    verdict = check(llm_confidence=0.99, unknown_formation=True)
    assert verdict.confidence == rules.UNKNOWN_FORMATION_CAP
    assert verdict.review_status == ReviewStatus.PENDING
    assert verdict.failed_rules == () and verdict.reason == "unknown_formation"


def test_low_ocr_confidence_is_reported():
    verdict = check(ocr_confidence=0.55)
    assert verdict.reasons == ("low_ocr_confidence",) and verdict.confidence == 0.55
    assert check(ocr_confidence=0.60).reasons == ()  # exactly 0.60 is not low


def test_reason_is_the_most_important_one():
    verdict = check({"mw_sg": 3.0}, snippet="not on the page anywhere in the whole text here",
                    unknown_formation=True, ocr_confidence=0.5)
    assert verdict.reasons == (
        "failed_rule:mw_out_of_range", "snippet_not_found", "unknown_formation", "low_ocr_confidence")
    assert verdict.reason == "failed_rule:mw_out_of_range"


# ---------------------------------------------------------------- formation order


def test_formation_order_flags_a_top_that_is_shallower_in_the_column_than_one_above_it():
    # (top_md, strat_order): Barail (6) at 2850 m sits above Tipam (5) at 2900 m -> Tipam is wrong
    tops = [(2310.0, 4), (2850.0, 6), (2900.0, 5)]
    assert rules.check_formation_order(tops) == {2}


def test_formation_order_ok_and_independent_of_list_order():
    assert rules.check_formation_order([(100.0, 1), (200.0, 2), (300.0, 2)]) == set()
    assert rules.check_formation_order([(300.0, 3), (100.0, 1), (200.0, 2)]) == set()
    assert rules.check_formation_order([]) == set()
