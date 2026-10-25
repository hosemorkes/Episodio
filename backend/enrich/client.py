"""HTTP-клиент для внешних API: пауза между запросами и повтор при 429, 5xx и сетевых сбоях."""
import time
from typing import Callable, Optional

import httpx

USER_AGENT = "Episodio/1.0 (personal media tracker)"

# TMDB разрешает около 40 запросов в секунду, мы ограничиваемся 4: не нужно спешить
DEFAULT_MIN_INTERVAL = 0.25
MAX_RETRY_DELAY = 30.0


class RateLimiter:
    """Следит, чтобы между запросами проходило не меньше min_interval секунд."""

    def __init__(
        self,
        min_interval: float = DEFAULT_MIN_INTERVAL,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.min_interval = min_interval
        self._clock = clock
        self._sleep = sleep
        self._last: Optional[float] = None

    def wait(self) -> None:
        if self._last is not None:
            delay = self._last + self.min_interval - self._clock()
            if delay > 0:
                self._sleep(delay)
        self._last = self._clock()


def retry_delay(response: Optional[httpx.Response], attempt: int) -> float:
    """Сколько ждать перед повтором: Retry-After, если сервер его прислал, иначе 1, 2, 4... секунд."""
    if response is not None:
        value = response.headers.get("Retry-After", "")
        try:
            return min(max(float(value), 0.0), MAX_RETRY_DELAY)
        except ValueError:
            pass
    return min(float(2 ** attempt), MAX_RETRY_DELAY)


class HttpFetcher:
    """GET-запросы с паузой между ними и повтором при 429, 5xx и сетевых ошибках.

    После последней неудачной попытки бросает httpx.HTTPError.
    """

    def __init__(
        self,
        *,
        transport: Optional[httpx.BaseTransport] = None,
        min_interval: float = DEFAULT_MIN_INTERVAL,
        max_retries: int = 3,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
        timeout: float = 15.0,
        user_agent: str = USER_AGENT,
    ):
        self._client = httpx.Client(
            transport=transport,
            timeout=timeout,
            follow_redirects=True,
            headers={"User-Agent": user_agent},
        )
        self._limiter = RateLimiter(min_interval, clock=clock, sleep=sleep)
        self._max_retries = max_retries
        self._sleep = sleep

    def get(self, url: str, params: Optional[dict] = None, headers: Optional[dict] = None) -> httpx.Response:
        for attempt in range(self._max_retries + 1):
            last_attempt = attempt == self._max_retries
            self._limiter.wait()
            try:
                response = self._client.get(url, params=params, headers=headers)
            except httpx.TransportError:
                if last_attempt:
                    raise
                self._sleep(retry_delay(None, attempt))
                continue

            if (response.status_code == 429 or response.status_code >= 500) and not last_attempt:
                self._sleep(retry_delay(response, attempt))
                continue
            response.raise_for_status()
            return response
        raise AssertionError("недостижимо")  # цикл всегда завершается return или исключением

    def close(self) -> None:
        self._client.close()


def download_image(fetcher: HttpFetcher, url: str) -> tuple[bytes, str]:
    """Скачивает картинку и возвращает (содержимое, content-type). Сохраняет её backend.posters.save_poster."""
    response = fetcher.get(url)
    return response.content, response.headers.get("content-type", "")
