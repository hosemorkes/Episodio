FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend ./backend
COPY scripts ./scripts

# Постеры лежат в /app/media/posters (на сервере это папка хоста ./media/posters), список записей для ручной
# проверки обогащения — в /app/data (том); приложение работает не от root (uid 1000)
RUN useradd --create-home --uid 1000 app && mkdir -p /app/media/posters /app/data && chown -R app:app /app/media /app/data
USER app

EXPOSE 8000
# Схема применяется при каждом старте (команда безопасна для повторного запуска)
CMD ["sh", "-c", "python -m scripts.init_db && uvicorn backend.main:app --host 0.0.0.0 --port 8000"]
