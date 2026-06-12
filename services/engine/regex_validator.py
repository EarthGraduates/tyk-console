import re
from typing import Any
from .validator import BaseValidator, Rule, RuleType, ValidationError


class RegexValidator(BaseValidator):
    async def validate(
        self,
        fields: dict[str, Any],
        rules: list[Rule],
        skip_fields: set[str],
    ) -> list[ValidationError]:
        errors: list[ValidationError] = []
        regex_rules = [r for r in rules
                       if r.rule_type == RuleType.REGEX and r.direction == "input"]

        for rule in regex_rules:
            field_key = rule.field_path or rule.field_name
            if field_key in skip_fields:
                continue
            value = fields.get(field_key)
            if value is None or value == "":
                continue  # empty → checked by required rules (future domain/required)

            pattern = rule.rule_config.get("pattern", "")
            if not pattern:
                continue
            if not re.match(pattern, str(value)):
                errors.append(ValidationError(
                    field=field_key,
                    rule_type=RuleType.REGEX,
                    message=rule.error_message or f"不匹配模式: {pattern}",
                ))
                skip_fields.add(field_key)

        return errors
