"""LAS 2.0 parser (BE-06), built on lasio."""

from __future__ import annotations

import io
import logging

import lasio
import pandas as pd

from app.ingest.parsers.units import UnknownUnitError, to_si

logger = logging.getLogger(__name__)

_DEPTH_UNIT_ALIASES = {"f": "ft", "ft.": "ft", "fts": "ft", "m.": "m", "mtr": "m"}


def parse_las(data: bytes) -> tuple[dict, pd.DataFrame]:
    """(well_info, curves) from LAS 2.0 bytes.

    * `well_info` maps each `~W` mnemonic to its value (numbers as floats), plus
      `"_units"`: {mnemonic: unit}.
    * `curves` has one column per curve, indexed by depth **in metres** (the
      index curve's own unit, usually m or ft, is converted). Null values are
      NaN. Curve values keep their file units: see `curves.attrs["units"]`
      ({mnemonic: unit}; the depth index is reported as "m").

    Raises ValueError if the bytes are not readable LAS.
    """
    text = data.decode("utf-8", errors="replace")
    try:
        las = lasio.read(io.StringIO(text))
    except Exception as exc:  # lasio raises assorted exception types on bad input
        raise ValueError(f"not a readable LAS file: {exc}") from exc
    if not las.curves:
        raise ValueError("LAS file has no curves")

    well_info: dict = {"_units": {}}
    for item in las.well:
        value = item.value
        if isinstance(value, str):
            value = value.strip()
        well_info[item.mnemonic] = value
        well_info["_units"][item.mnemonic] = (item.unit or "").strip()

    frame = las.df()  # index = first curve (depth), other curves as columns
    index_mnemonic = las.curves[0].mnemonic
    depth_unit = (las.curves[0].unit or "m").strip()
    depth_unit = _DEPTH_UNIT_ALIASES.get(depth_unit.lower(), depth_unit)
    try:
        factor = to_si(1.0, depth_unit)[0]
    except UnknownUnitError:
        logger.warning("unknown LAS depth unit %r; assuming metres", depth_unit)
        factor = 1.0
    frame.index = pd.Index(frame.index.to_numpy(dtype=float) * factor, name=index_mnemonic)

    frame.attrs["units"] = {index_mnemonic: "m", **{c.mnemonic: (c.unit or "").strip() for c in las.curves[1:]}}
    return well_info, frame
