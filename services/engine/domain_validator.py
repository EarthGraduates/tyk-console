from typing import Any
from .validator import BaseValidator, Rule, RuleType, ValidationError


class DomainValidator(BaseValidator):
    async def validate(
        self,
        fields: dict[str, Any],
        rules: list[Rule],
        skip_fields: set[str],
    ) -> list[ValidationError]:
        errors: list[ValidationError] = []
        domain_rules = [r for r in rules
                        if r.rule_type == RuleType.DOMAIN and r.direction == "input"]

        for rule in domain_rules:
            field_key = rule.field_path or rule.field_name
            if field_key in skip_fields:
                continue
            value = fields.get(field_key)
            if value is None or value == "":
                continue

            sub_type = rule.rule_config.get("type")

            if sub_type == "enum":
                allowed = rule.rule_config.get("values", [])
                if value not in allowed:
                    errors.append(ValidationError(
                        field=field_key,
                        rule_type=RuleType.DOMAIN,
                        message=rule.error_message or f"值不在允许范围: {allowed}",
                    ))

            elif sub_type == "range":
                min_val = rule.rule_config.get("min")
                max_val = rule.rule_config.get("max")
                try:
                    num_val = float(value) if not isinstance(value, (int, float)) else value
                    if (min_val is not None and num_val < min_val) or \
                       (max_val is not None and num_val > max_val):
                        errors.append(ValidationError(
                            field=field_key,
                            rule_type=RuleType.DOMAIN,
                            message=rule.error_message or f"值超出范围 [{min_val}, {max_val}]",
                        ))
                except (ValueError, TypeError):
                    errors.append(ValidationError(
                        field=field_key,
                        rule_type=RuleType.DOMAIN,
                        message=rule.error_message or f"值不是有效数字",
                    ))

            elif sub_type == "type":
                expected_type = rule.rule_config.get("field_type", "")
                max_len = rule.rule_config.get("max_length")
                if expected_type == "String" and max_len and isinstance(value, str):
                    if len(value) > max_len:
                        errors.append(ValidationError(
                            field=field_key,
                            rule_type=RuleType.DOMAIN,
                            message=rule.error_message or f"字符串长度超过 {max_len}",
                        ))

        return errors
