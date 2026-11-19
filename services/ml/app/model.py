"""
Ridership model.

Target: show-up rate = boarded / expected_max for one slot on one day.
Two gradient-boosted trees (scikit-learn HistGradientBoosting):
  * mean rate (squared error, weighted by expected_max)
  * 90th percentile rate (quantile loss) -> the "safe" number to allocate seats for
Predicting a rate rather than a count keeps the model valid for routes and
slot sizes it has not seen.

Before there is enough boarding data, a baseline is used:
  per-slot history if available, else the configured cold-start attendance factor.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

from .features import FEATURES

MIN_TRAINING_ROWS = 300
CATEGORICAL = ["weekday"]


@dataclass
class TrainedModel:
    version: str
    mean: HistGradientBoostingRegressor
    p90: HistGradientBoostingRegressor
    metrics: dict

    def predict(self, frame: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
        x = frame[FEATURES]
        mean = np.clip(self.mean.predict(x), 0.0, 1.3)
        hi = np.clip(self.p90.predict(x), 0.0, 1.5)
        return mean, np.maximum(hi, mean)


def baseline_rates(frame: pd.DataFrame, cold_start: float) -> tuple[np.ndarray, np.ndarray]:
    """Historical per-slot rate where we have >= 3 observations, otherwise the cold-start factor."""
    has = (frame["slot_obs"] >= 3).to_numpy()
    mean = np.where(has, frame["slot_rate_mean"].fillna(cold_start).to_numpy(), cold_start)
    p90 = np.where(has, frame["slot_rate_p90"].fillna(cold_start).to_numpy(), min(1.0, cold_start * 1.15))
    return mean, np.maximum(p90, mean)


def to_counts(expected: np.ndarray, mean_rate: np.ndarray, p90_rate: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    predicted = np.rint(expected * mean_rate).astype(int)
    p90 = np.ceil(expected * p90_rate).astype(int)
    return predicted, np.maximum(p90, predicted)


def train(frame: pd.DataFrame, seed: int = 7) -> TrainedModel:
    if len(frame) < MIN_TRAINING_ROWS:
        raise ValueError(f"Need at least {MIN_TRAINING_ROWS} slot-days with boarding data, got {len(frame)}")
    data = frame[frame["expected_max"] > 0]
    y = (data["boarded"] / data["expected_max"]).clip(0, 1.5)
    w = data["expected_max"].clip(1, None)
    cat = [FEATURES.index(c) for c in CATEGORICAL]
    common = dict(max_iter=300, learning_rate=0.05, max_leaf_nodes=31, min_samples_leaf=20, categorical_features=cat, random_state=seed)
    mean = HistGradientBoostingRegressor(loss="squared_error", **common).fit(data[FEATURES], y, sample_weight=w)
    p90 = HistGradientBoostingRegressor(loss="quantile", quantile=0.9, **common).fit(data[FEATURES], y, sample_weight=w)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M")
    digest = hashlib.sha1(pd.util.hash_pandas_object(data[FEATURES + ["boarded"]], index=False).values.tobytes()).hexdigest()[:6]
    return TrainedModel(version=f"hgb-{stamp}-{digest}", mean=mean, p90=p90, metrics={"rows": int(len(data))})


def evaluate(expected: np.ndarray, actual: np.ndarray, predicted: np.ndarray, p90: np.ndarray) -> dict:
    """WAPE and MAE on riders; coverage = share of trips where the P90 seats were enough."""
    err = np.abs(actual - predicted)
    total = actual.sum()
    return {
        "mae": round(float(err.mean()), 3),
        "wape": round(float(err.sum() / total), 4) if total else None,
        "p90_coverage": round(float((actual <= p90).mean()), 4),
        "under_capacity_rate": round(float((actual > p90).mean()), 4),
        "empty_seat_rate": round(float(np.clip(p90 - actual, 0, None).sum() / max(1, p90.sum())), 4),
        "rows": int(len(actual)),
    }


class ModelStore:
    """Saves models under MODEL_DIR with a latest.json pointer. Only promoted models are served."""

    def __init__(self, root: str | os.PathLike | None = None):
        self.root = Path(root or os.environ.get("MODEL_DIR", Path(__file__).resolve().parent.parent / "artifacts"))
        self.root.mkdir(parents=True, exist_ok=True)
        self._cache: TrainedModel | None = None

    def save(self, model: TrainedModel, promote: bool) -> Path:
        path = self.root / f"{model.version}.joblib"
        joblib.dump(model, path)
        (self.root / f"{model.version}.metrics.json").write_text(json.dumps(model.metrics, indent=2))
        if promote:
            (self.root / "latest.json").write_text(json.dumps({"version": model.version, "file": path.name}))
            self._cache = model
        return path

    def latest(self) -> TrainedModel | None:
        pointer = self.root / "latest.json"
        if not pointer.exists():
            return None
        meta = json.loads(pointer.read_text())
        if self._cache and self._cache.version == meta["version"]:
            return self._cache
        self._cache = joblib.load(self.root / meta["file"])  # artifacts are written only by this service
        return self._cache


def safe_int(x: float) -> int:
    return int(x) if math.isfinite(x) else 0
