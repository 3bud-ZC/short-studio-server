"""KemeTone Provider for Egyptian/Cairene Arabic (Rabe3/kemetone)."""
from pathlib import Path
from typing import List, Optional, Tuple
import numpy as np
from app.config import KEMETONE_DEFAULT_SPEAKER, KEMETONE_REPO_ID, KEMETONE_REVISION, MODEL_CACHE_DIR
from app.providers.base import BaseTTSProvider
from app.schemas import VoiceItem

KEMETONE_SPEAKERS: List[VoiceItem] = [
    VoiceItem(
        id="kemetone",
        name="KemeTone (Cairene Female)",
        gender="female",
        provider="kemetone",
        is_default=True,
    ),
]

class KemeToneProvider(BaseTTSProvider):
    """Pinned KemeTone files are retained, but no real inference adapter is shipped yet."""

    def __init__(self, cache_dir: Optional[str] = None):
        self.cache_dir = Path(cache_dir or MODEL_CACHE_DIR) / "tts" / "kemetone"
        self._model = None
        self._is_loaded = False

    def is_ready(self) -> bool:
        return False

    def files_installed(self) -> bool:
        return (self.cache_dir / "config.json").exists() or (self.cache_dir / "metadata.json").exists()

    def load(self) -> None:
        raise RuntimeError("KemeTone is installed but not live-qualified for real synthesis in this release.")

    def unload(self) -> None:
        self._model = None
        self._is_loaded = False

    def synthesize(
        self,
        text: str,
        speaker_id: str = "kemetone",
        speed: float = 1.0,
        **kwargs,
    ) -> Tuple[np.ndarray, int]:
        raise RuntimeError("KemeTone is installed but not live-qualified for real synthesis in this release.")
