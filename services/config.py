"""
ICHSE Validation Service — Iteration 1: Bare pass-through
POST /rest/{func_name} → PostgREST /rpc/{func_name}
"""
import os

POSTGREST_URL = os.getenv("POSTGREST_URL", "http://localhost:3001")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6380/0")
SERVICE_PORT = int(os.getenv("SERVICE_PORT", "8000"))
