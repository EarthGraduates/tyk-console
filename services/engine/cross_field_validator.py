from typing import Any
from .validator import BaseValidator, Rule, RuleType, ValidationError


class CrossFieldValidator(BaseValidator):
    async def validate(
        self,
        fields: dict[str, Any],
        rules: list[Rule],
        skip_fields: set[str],
    ) -> list[ValidationError]:
        errors: list[ValidationError] = []
        cross_rules = [r for r in rules if r.rule_type == RuleType.CROSS_FIELD]

        for rule in cross_rules:
            relation = rule.rule_config.get("relation")
            target = rule.rule_config.get("target_field", "")

            if relation == "required_if":
                cond = rule.rule_config.get("condition", {})
                cond_field = cond.get("field", "")
                cond_value = fields.get(cond_field)
                if cond_value is not None and fields.get(target) is None:
                    errors.append(ValidationError(
                        field=target,
                        rule_type=RuleType.CROSS_FIELD,
                        message=rule.error_message or f"{target} 为必填（当 {cond_field} 存在时）",
                    ))

            elif relation == "required_with":
                other = rule.rule_config.get("other_field", "")
                has_other = fields.get(other) is not None
                has_target = fields.get(target) is not None
                if has_other and not has_target:
                    errors.append(ValidationError(
                        field=target,
                        rule_type=RuleType.CROSS_FIELD,
                        message=rule.error_message or f"{target} 必须与 {other} 同时存在",
                    ))

            elif relation in ("gt", "gte"):
                other_field = rule.rule_config.get("other_field", "")
                val = fields.get(rule.field_path or rule.field_name)
                other_val = fields.get(other_field)
                if val is not None and other_val is not None:
                    try:
                        nv, ov = float(val), float(other_val)
                        if relation == "gt" and nv <= ov:
                            errors.append(ValidationError(
                                field=rule.field_path or rule.field_name,
                                rule_type=RuleType.CROSS_FIELD,
                                message=rule.error_message or f"必须大于 {other_field}",
                            ))
                        elif relation == "gte" and nv < ov:
                            errors.append(ValidationError(
                                field=rule.field_path or rule.field_name,
                                rule_type=RuleType.CROSS_FIELD,
                                message=rule.error_message or f"必须大于等于 {other_field}",
                            ))
                    except (ValueError, TypeError):
                        pass

        return errors
