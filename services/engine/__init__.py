"""
Validation engine — Chain of Responsibility + Strategy pattern.

Usage:
    engine = ValidationEngine(rule_loader)
    result = await engine.validate(func_name, payload)
    if not result.success:
        return JSONResponse({"code": 400, "errors": [...]})
"""
import time
from typing import Any

from .validator import (
    BaseValidator, Rule, RuleType, ValidationError, ValidationResult,
)
from .regex_validator import RegexValidator
from .domain_validator import DomainValidator
from .cross_field_validator import CrossFieldValidator


class ValidationEngine:
    def __init__(self, rule_loader):
        self.rule_loader = rule_loader
        self.validators: list[BaseValidator] = [
            RegexValidator(),
            DomainValidator(),
            CrossFieldValidator(),
        ]

    async def validate(self, func_name: str, payload: dict) -> ValidationResult:
        start = time.perf_counter()

        rules_data = await self.rule_loader.load(func_name)
        rules = [_dict_to_rule(r) for r in rules_data]

        errors: list[ValidationError] = []
        skip_fields: set[str] = set()

        # Flatten nested payload for field access
        # e.g., {"dataInfoList": [{"sampleType": "01"}]} → sampleType accessible
        fields = _flatten_payload(payload)

        for validator in self.validators:
            errors.extend(await validator.validate(fields, rules, skip_fields))

        duration_ms = int((time.perf_counter() - start) * 1000)
        return ValidationResult(
            success=len(errors) == 0,
            errors=errors,
            duration_ms=duration_ms,
        )


def _dict_to_rule(d: dict) -> Rule:
    return Rule(
        id=d["id"],
        rule_type=RuleType(d["rule_type"]),
        rule_config=d["rule_config"],
        error_message=d.get("error_message"),
        field_name=d["field_name"],
        field_path=d.get("field_path"),
        field_type=d.get("field_type", "String"),
        direction=d.get("direction", "input"),
    )


def _flatten_payload(payload: dict, prefix: str = "") -> dict[str, Any]:
    """Flatten nested JSON so field_path like dataInfoList[].sampleType can be matched."""
    result: dict[str, Any] = {}
    for key, value in payload.items():
        full_key = f"{prefix}{key}"
        if isinstance(value, dict):
            result.update(_flatten_payload(value, f"{full_key}."))
        elif isinstance(value, list):
            result[full_key] = value
            # Also flatten first element for array-of-objects access
            if value and isinstance(value[0], dict):
                result.update(_flatten_payload(value[0], f"{full_key}[0]."))
                # Also add without [0] prefix for direct access
                result.update(_flatten_payload(value[0], ""))
        else:
            result[full_key] = value
            # Also add without prefix for top-level direct access
            if prefix == "":
                result[key] = value
    return result


__all__ = [
    "ValidationEngine",
    "BaseValidator",
    "Rule",
    "RuleType",
    "ValidationError",
    "ValidationResult",
    "RegexValidator",
    "DomainValidator",
    "CrossFieldValidator",
]
