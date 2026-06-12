from fastapi import APIRouter

router = APIRouter()


def get_rule_loader():
    """Lazy import to avoid circular deps — set by main on startup."""
    from main import rule_loader
    return rule_loader


@router.post("/admin/refresh-rules")
async def refresh_rules():
    loader = get_rule_loader()
    total = await loader.refresh_all()
    return {"status": "ok", "rules_cached": total}
