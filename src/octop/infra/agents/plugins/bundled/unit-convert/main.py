"""Unit conversion — length, mass, temperature."""

from __future__ import annotations

import json
from typing import Any

from octop_harness.plugins import PluginContext

_LENGTH_TO_M: dict[str, float] = {
    "m": 1.0,
    "km": 1000.0,
    "cm": 0.01,
    "mi": 1609.344,
    "ft": 0.3048,
    "in": 0.0254,
}
_MASS_TO_KG: dict[str, float] = {
    "kg": 1.0,
    "g": 0.001,
    "lb": 0.45359237,
    "oz": 0.028349523125,
}
_TEMP = frozenset({"c", "f", "k"})


def _payload(data: dict[str, Any], text: str) -> str:
    return json.dumps(
        {"octop_ui": {"renderer": "unit_convert_card", "version": 1}, "data": data, "text": text},
        ensure_ascii=False,
    )


def _norm(unit: str) -> str:
    return (unit or "").strip().lower()


def _convert_temp(value: float, src: str, dst: str) -> float:
    if src == dst:
        return value
    if src == "c":
        k = value + 273.15
    elif src == "f":
        k = (value - 32.0) * 5.0 / 9.0 + 273.15
    else:
        k = value
    if dst == "c":
        return k - 273.15
    if dst == "f":
        return (k - 273.15) * 9.0 / 5.0 + 32.0
    return k


async def convert_unit(value: float, from_unit: str, to_unit: str) -> str:
    """Convert between compatible units."""
    src = _norm(from_unit)
    dst = _norm(to_unit)
    try:
        v = float(value)
    except (TypeError, ValueError):
        return _payload({"error": "invalid value"}, "value must be a number.")
    if src in _TEMP or dst in _TEMP:
        if src not in _TEMP or dst not in _TEMP:
            return _payload(
                {"error": "category mismatch"},
                "temperature units c/f/k cannot be converted to or from length or mass.",
            )
        result = _convert_temp(v, src, dst)
        category = "temperature"
    elif src in _LENGTH_TO_M and dst in _LENGTH_TO_M:
        meters = v * _LENGTH_TO_M[src]
        result = meters / _LENGTH_TO_M[dst]
        category = "length"
    elif src in _MASS_TO_KG and dst in _MASS_TO_KG:
        kg = v * _MASS_TO_KG[src]
        result = kg / _MASS_TO_KG[dst]
        category = "mass"
    else:
        return _payload(
            {"error": "unknown or incompatible units"},
            "unsupported unit or category mismatch. length: m,km,cm,mi,ft,in; mass: kg,g,lb,oz; temperature: c,f,k.",
        )
    data = {
        "value": v,
        "from_unit": src,
        "to_unit": dst,
        "result": round(result, 6),
        "category": category,
    }
    text = f"{v} {src} = {data['result']} {dst}"
    return _payload(data, text)


def setup(ctx: PluginContext) -> None:
    ctx.tool(
        "convert_unit",
        convert_unit,
        description="Unit conversion. length/mass/temperature each convert within their category; a category mismatch raises an error.",
    )
