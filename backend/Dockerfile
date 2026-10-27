FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend ./backend
COPY scripts ./scripts

# Постеры лежат в /app/media/posters (том), приложение работает не от root
RUN useradd --create-home --uid 1000 app && mkdir -p /app/media/posters && chown -R app:app /app/media
USER app

EXPOSE 8000
# Схема применяется при каждом старте (команда безопасна для повторного запуска)
CMD ["sh", "-c", "python -m scripts.init_db && uvicorn backend.main:app --host 0.0.0.0 --port 8000"]
