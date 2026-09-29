import os
import logging
from typing import List, Optional

logger = logging.getLogger(__name__)

class EdgeEmbedder:
    """
    Lightweight, fast local text embedding generator running on CPU via FastEmbed.
    Default: sentence-transformers/all-MiniLM-L6-v2 cached locally in data/model_cache (384 dimensions).
    """
    def __init__(self, model_name: Optional[str] = None, cache_dir: Optional[str] = None):
        default_cache = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data", "model_cache"))
        self.cache_dir = cache_dir or (default_cache if os.path.exists(default_cache) else None)
        
        # Prefer locally cached model if available
        if model_name:
            self.model_name = model_name
        elif self.cache_dir and os.path.exists(os.path.join(self.cache_dir, "models--qdrant--all-MiniLM-L6-v2-onnx")):
            self.model_name = "sentence-transformers/all-MiniLM-L6-v2"
        else:
            self.model_name = "BAAI/bge-small-en-v1.5"

        self._model = None

    def _load_model(self):
        if self._model is None:
            try:
                from fastembed import TextEmbedding
                logger.info(f"Loading FastEmbed model: {self.model_name}")
                kwargs = {"model_name": self.model_name}
                if self.cache_dir:
                    kwargs["cache_dir"] = self.cache_dir
                    kwargs["local_files_only"] = True
                try:
                    self._model = TextEmbedding(**kwargs)
                except Exception:
                    # Fallback without local_files_only if online
                    kwargs.pop("local_files_only", None)
                    self._model = TextEmbedding(**kwargs)
            except Exception as e:
                logger.error(f"Failed to load FastEmbed model: {e}")
                raise

    def embed_text(self, text: str) -> List[float]:
        self._load_model()
        vectors = list(self._model.embed([text]))
        return vectors[0].tolist()

    def embed_batch(self, texts: List[str]) -> List[List[float]]:
        self._load_model()
        vectors = list(self._model.embed(texts))
        return [vec.tolist() for vec in vectors]

