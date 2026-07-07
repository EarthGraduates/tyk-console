"""
ICHSE Validation Service — config
"""
import os

POSTGREST_URL = os.getenv("POSTGREST_URL", "http://localhost:3001")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6380/0")
SERVICE_PORT = int(os.getenv("SERVICE_PORT", "8000"))
PG_DSN = os.getenv("PG_DSN", "postgresql://ichse:change_me@localhost:5433/ichse")
TYK_URL = os.getenv("TYK_URL", "http://localhost:8080")
TYK_SECRET = os.getenv("TYK_SECRET", "change-me-tyk-secret")
SERVICES_URL = os.getenv("SERVICES_URL", "http://localhost:8000")
