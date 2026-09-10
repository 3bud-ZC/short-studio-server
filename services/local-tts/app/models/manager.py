"""Local Model Manager with Mutex Concurrency & Lazy Loading."""
import asyncio
import json
import os
import time
from pathlib import Path
from typing import Dict, List, Optional
from app.config import (
    IDLE_UNLOAD_SECONDS,
    KEMETONE_REPO_ID,
    KEMETONE_REVISION,
    MODEL_CACHE_DIR,
    VOICETUT_REPO_ID,
    VOICETUT_REVISION,
)
from app.providers.base import BaseTTSProvider
from app.providers.kemetone import KemeToneProvider, KEMETONE_SPEAKERS
from app.providers.voicetut import VoiceTutProvider, VOICETUT_SPEAKERS
from app.schemas import ModelItem, VoiceItem

class ModelManager:
    _instance: Optional["ModelManager"] = None

    def __init__(self):
        self.lock = asyncio.Lock()
        self.voicetut = VoiceTutProvider()
        self.kemetone = KemeToneProvider()
        self._last_active_at = time.time()

    @classmethod
    def get_instance(cls) -> "ModelManager":
        if cls._instance is None:
            cls._instance = ModelManager()
        return cls._instance

    def get_provider(self, model_id: str) -> BaseTTSProvider:
        if model_id == "voicetut":
            return self.voicetut
        if model_id == "kemetone":
            return self.kemetone
        raise ValueError(f"Unknown local TTS model '{model_id}'. Must be 'voicetut' or 'kemetone'.")

    def get_voices(self, model_id: str) -> List[VoiceItem]:
        if model_id == "voicetut":
            return VOICETUT_SPEAKERS
        if model_id == "kemetone":
            return KEMETONE_SPEAKERS
        raise ValueError(f"Unknown local TTS model '{model_id}'.")

    def list_models(self) -> List[ModelItem]:
        vt_ready = self.voicetut.is_ready()
        kt_installed = self.kemetone.files_installed()

        vt_bytes = self._dir_size(self.voicetut.cache_dir)
        kt_bytes = self._dir_size(self.kemetone.cache_dir)

        return [
            ModelItem(
                id="voicetut",
                name="VoiceTut Local High Quality",
                repo_id=VOICETUT_REPO_ID,
                revision=VOICETUT_REVISION,
                state="ready" if vt_ready else "not_installed",
                downloaded_bytes=vt_bytes,
                license="Apache-2.0",
                speakers_count=17,
                dialect="egyptian",
                sample_rate=24000,
                device=self.voicetut.device,
                load_time_seconds=self.voicetut.load_time_seconds,
            ),
            ModelItem(
                id="kemetone",
                name="KemeTone Local Lightweight",
                repo_id=KEMETONE_REPO_ID,
                revision=KEMETONE_REVISION,
                state="not_live_qualified" if kt_installed else "not_installed",
                downloaded_bytes=kt_bytes,
                license="Apache-2.0",
                speakers_count=1,
                dialect="egyptian",
                sample_rate=24000,
            ),
        ]

    def _dir_size(self, path: Path) -> int:
        if not path.exists():
            return 0
        total = 0
        for entry in path.rglob("*"):
            if entry.is_file():
                total += entry.stat().st_size
        return total
