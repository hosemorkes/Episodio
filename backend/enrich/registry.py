"""Реестр провайдеров: какой источник обслуживает какую категорию, создание провайдеров и скачивание постеров."""
from typing import Callable, Optional
from urllib.parse import urlparse

from backend.enrich.base import Provider, ProviderError, UnsupportedCategoryError
from backend.enrich.client import download_image
from backend.enrich.openlibrary import OpenLibraryProvider
from backend.enrich.shikimori import ShikimoriProvider
from backend.enrich.tmdb import TMDBProvider

# Каждая категория записи обслуживается ровно одним провайдером
PROVIDER_CLASSES = (TMDBProvider, ShikimoriProvider, OpenLibraryProvider)
ALL_CATEGORIES = frozenset().union(*(cls.categories for cls in PROVIDER_CLASSES))


def build_providers(category: Optional[str] = None) -> tuple[list[Provider], list[str]]:
    """Создаёт провайдеров: нужного для категории или всех. Возвращает (провайдеры, причины пропуска).

    Провайдер, которому не хватает настроек (нет ключа или User-Agent), пропускается с пояснением.
    """
    providers, skipped = [], []
    for cls in PROVIDER_CLASSES:
        if category and category not in cls.categories:
            continue
        try:
            providers.append(cls())
        except ProviderError as e:
            skipped.append(str(e))
    return providers, skipped


def make_downloader(providers: list[Provider]) -> Callable[[str], tuple[bytes, str]]:
    """Скачивает постер через клиент того провайдера, чей хост у картинки: так соблюдаются его лимиты запросов."""
    fetchers = {host: provider.fetcher for provider in providers for host in provider.image_hosts}

    def download(url: str) -> tuple[bytes, str]:
        fetcher = fetchers.get(urlparse(url).hostname)
        if fetcher is None:
            raise ProviderError(f"Неизвестный источник картинки: {url}")
        return download_image(fetcher, url)

    return download


class Enricher:
    """Провайдеры для API. Создаются при первом обращении и переиспользуются (кэш жанров, лимиты запросов)."""

    def __init__(self, provider_classes=PROVIDER_CLASSES):
        self._classes = provider_classes
        self._providers: dict = {}

    def provider_for(self, category: str) -> Provider:
        """Провайдер категории. Бросает UnsupportedCategoryError или ProviderConfigError (нет ключа и т.п.)."""
        for cls in self._classes:
            if category in cls.categories:
                if cls not in self._providers:
                    self._providers[cls] = cls()
                return self._providers[cls]
        raise UnsupportedCategoryError(f"Для категории «{category}» обогащение не поддерживается")

    def download(self, url: str) -> tuple[bytes, str]:
        """Скачивает картинку через клиент провайдера, чей хост совпадает с адресом."""
        return make_downloader(list(self._providers.values()))(url)

    def close(self) -> None:
        for provider in self._providers.values():
            provider.fetcher.close()
        self._providers.clear()
