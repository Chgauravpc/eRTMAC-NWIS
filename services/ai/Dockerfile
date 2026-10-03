FROM python:3.11-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        tesseract-ocr \
        libgl1 \
        libglib2.0-0 \
        poppler-utils \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 1000 appuser

WORKDIR /app

# Model caches live inside the image: a Space has no persistent disk, so anything downloaded at run time is
# downloaded again at every restart (a cold start would take minutes and the first upload would time out).
ENV PYTHONUNBUFFERED=1 \
    HF_HOME=/app/.cache/huggingface \
    DOCLING_ARTIFACTS_PATH=/app/.cache/docling

COPY requirements.txt .
# The Space is CPU-only: install the CPU wheel of torch first so pip does not pull the multi-GB CUDA build
# that sentence-transformers would otherwise depend on. Versions are pinned (requirements.txt from the working venv).
RUN pip install --no-cache-dir torch==2.14.0 --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt

# Bake the models in: the embedding model, Docling's layout and table models, and the RapidOCR models.
RUN python -c "from sentence_transformers import SentenceTransformer as S; S('BAAI/bge-small-en-v1.5')" \
    && docling-tools models download layout tableformer rapidocr -o /app/.cache/docling \
    && python -c "import numpy as np; from rapidocr import RapidOCR; RapidOCR()(np.full((64, 256, 3), 255, dtype=np.uint8))"

COPY . .
RUN chown -R appuser:appuser /app

USER appuser

# everything the service needs is in the image: never go to the Hugging Face Hub at run time
ENV HF_HUB_OFFLINE=1

EXPOSE 7860

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860", "--workers", "1"]
