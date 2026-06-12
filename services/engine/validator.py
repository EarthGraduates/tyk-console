"""
Validation engine — Chain of Responsibility + Strategy pattern
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any
import re


class RuleType(str, Enum):
    REGEX = "regex"
    DOMAIN = "domain"
    CROSS_FIELD = "cross_field"


class DomainSubType(str, Enum):
    ENUM = "enum"
    RANGE = "range"
    TYPE = "type"


class CrossFieldRelation(str, Enum):
    REQUIRED_IF = "required_if"
    REQUIRED_WITH = "required_with"
    GT = "gt"
    GTE = "gte"


@dataclass
class Rule:
    id: int
    rule_type: RuleType
    rule_config: dict
    error_message: str | None
    field_name: str
    field_path: str | None
    field_type: str
    direction: str


@dataclass
class ValidationError:
    field: str
    rule_type: RuleType
    message: str


@dataclass
class ValidationResult:
    success: bool
    errors: list[ValidationError] = field(default_factory=list)
    duration_ms: int = 0


class BaseValidator(ABC):
    @abstractmethod
    async def validate(
        self,
        fields: dict[str, Any],
        rules: list[Rule],
        skip_fields: set[str],
    ) -> list[ValidationError]: ...
