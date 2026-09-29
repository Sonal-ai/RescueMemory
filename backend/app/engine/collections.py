import logging
from qdrant_client import QdrantClient
from qdrant_client.http import models

logger = logging.getLogger(__name__)

REF_COLLECTION = "reference_immutable"
MUTABLE_COLLECTION = "local_mutable"
VECTOR_DIM = 384


def init_collections(client: QdrantClient) -> None:
    """
    Creates the dual-collection topology with Int8 Scalar Quantization in RAM.
    - reference_immutable: Read-only pre-loaded disaster survival protocols & baseline checkpoints.
    - local_mutable: Read-write edge collection for survivor SOS casualty reports & dynamic hazard updates.
    """
    existing = [c.name for c in client.get_collections().collections]

    for coll_name in [REF_COLLECTION, MUTABLE_COLLECTION]:
        if coll_name not in existing:
            logger.info(f"Creating collection '{coll_name}' with INT8 scalar quantization...")
            client.create_collection(
                collection_name=coll_name,
                vectors_config=models.VectorParams(
                    size=VECTOR_DIM,
                    distance=models.Distance.COSINE
                ),
                quantization_config=models.ScalarQuantization(
                    scalar=models.ScalarQuantizationConfig(
                        type=models.ScalarType.INT8,
                        always_ram=True
                    )
                )
            )
        else:
            logger.debug(f"Collection '{coll_name}' already exists.")
