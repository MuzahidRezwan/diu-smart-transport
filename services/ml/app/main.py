"""FastAPI entry point. Internal service: reachable only from the API, protected by a shared token."""
from __future__ import annotations

import hmac
import os

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile

from .fetcher import FetchError, fetch
from .forecast import run_forecast
from .model import ModelStore
from .optimizer import optimize
from .routine_parser import parse_file
from .schemas import FetchRequest, ForecastRequest, ForecastResponse, ParsedRoutine, PlanRequest, PlanResponse

MAX_UPLOAD = 5 * 1024 * 1024
TOKEN = os.environ.get("ML_SERVICE_TOKEN", "")
if os.environ.get("ENV") == "production" and not TOKEN:
    raise RuntimeError("ML_SERVICE_TOKEN is required in production")

app = FastAPI(title="DIU Transport ML", version="0.1.0", docs_url="/docs" if os.environ.get("ENV") != "production" else None)
store = ModelStore()


def require_token(authorization: str | None = Header(default=None)) -> None:
    if TOKEN and not hmac.compare_digest(authorization or "", f"Bearer {TOKEN}"):
        raise HTTPException(status_code=401, detail="Missing or wrong service token")


@app.get("/health")
def health() -> dict:
    model = store.latest()
    return {"ok": True, "model": model.version if model else None}


@app.post("/v1/forecast", response_model=ForecastResponse, dependencies=[Depends(require_token)])
def forecast(req: ForecastRequest) -> ForecastResponse:
    return run_forecast(req, store)


@app.post("/v1/allocation/plan", response_model=PlanResponse, dependencies=[Depends(require_token)])
def plan(req: PlanRequest) -> PlanResponse:
    return optimize(req)


@app.post("/v1/routines/parse", response_model=ParsedRoutine, dependencies=[Depends(require_token)])
async def parse_routine(file: UploadFile = File(...), department: str = Form(..., min_length=2, max_length=80)) -> ParsedRoutine:
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(status_code=413, detail="File is larger than 5 MB")
    try:
        return parse_file(file.filename or "upload", data, department)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e


@app.post("/v1/routines/fetch", response_model=ParsedRoutine, dependencies=[Depends(require_token)])
def fetch_routine(req: FetchRequest) -> ParsedRoutine:
    try:
        name, data = fetch(req.url)
        return parse_file(name, data, req.department)
    except FetchError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
