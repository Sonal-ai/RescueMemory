# Stage 1: Build React Frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci || npm install

COPY frontend/ ./
RUN npm run build

# Stage 2: Python Backend & Unified Static Server
FROM python:3.11-slim
WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    NODE_ROLE=central \
    NODE_ID=central-cloud-hq \
    PORT=8000 \
    DATA_DIR=/app/data \
    MODEL_CACHE=/app/data/model_cache

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/ /app/backend/

# Copy built web distribution
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Expose default port
EXPOSE 8000

# Start Uvicorn bound to $PORT or default 8000
CMD ["sh", "-c", "uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
