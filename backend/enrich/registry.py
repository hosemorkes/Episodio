"""Реестр провайдеров: какой источник обслуживает какую категорию, создание провайдеров и скачивание постеров."""
from typing import Callable, Optional
from urllib.parse import urlparse

from backend.enrich.base import Provider, ProviderConfigError, ProviderError, UnsupportedCategoryError
from backend.enrich.anilist import AniListProvider
from backend.enrich.client import download_image
from backend.enrich.openlibrary import OpenLibraryProvider
from backend.enrich.shikimori import ShikimoriProvider
from backend.enrich.tmdb import TMDBProvider
from backend.enrich.tvdb import TVDBProvider

# Категорию может обслуживать несколько провайдеров (аниме и манга: Shikimori и AniList; сериалы и фильмы: TMDB и TheTVDB).
# Источником по умолчанию считается первый подходящий и настроенный в этом списке; другой выбирается явно
# (параметр source, опция --source скрипта)
PROVIDER_CLASSES = (TMDBProvider, TVDBProvider, ShikimoriProvider, AniListProvider, OpenLibraryProvider)
ALL_CATEGORIES = frozenset().union(*(cls.categories for cls in PROVIDER_CLASSES))


def categories_of(source: str) -> frozenset[str]:
    """Категории, которые обслуживает источник (пусто, если такого источника нет)."""
    return next((cls.categories for cls in PROVIDER_CLASSES if cls.source == source), frozenset())


def sources_for(category: str) -> list[str]:
    """Источники категории, по умолчанию первый."""
    return [cls.source for cls in PROVIDER_CLASSES if category in cls.categories]


def build_providers(category: Optional[str] = None, source: Optional[str] = None) -> tuple[list[Provider], list[str]]:
    """Создаёт провайдеров: нужного для категории (и источника) или всех. Возвращает (провайдеры, причины пропуска).

    Провайдер, которому не хватает настроек (нет ключа или User-Agent), пропускается с пояснением.
    """
    providers, skipped = [], []
    for cls in PROVIDER_CLASSES:
        if category and category not in cls.categories:
            continue
        if source and cls.source != source:
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

    def provider_for(self, category: str, source: Optional[str] = None) -> Provider:
        """Провайдер категории: указанный источник или первый подходящий (по умолчанию).

        Без явного источника ненастроенный провайдер пропускается в пользу следующего (нет ключа TMDB — работает TheTVDB).
        Бросает UnsupportedCategoryError (нет источника для категории) или ProviderConfigError (нет ключа и т.п.).
        """
        config_error: Optional[ProviderConfigError] = None
        for cls in self._classes:
            if category in cls.categories and (source is None or cls.source == source):
                if cls not in self._providers:
                    try:
                        self._providers[cls] = cls()
                    except ProviderConfigError as e:
                        if source is not None:
                            raise
                        config_error = config_error or e
                        continue
                return self._providers[cls]
        if config_error is not None:
            raise config_error
        if source is not None and any(category in cls.categories for cls in self._classes):
            raise UnsupportedCategoryError(f"Источник «{source}» не обслуживает категорию «{category}»")
        raise UnsupportedCategoryError(f"Для категории «{category}» обогащение не поддерживается")

    def categories_of(self, source: str) -> frozenset[str]:
        """Категории источника (по классам: провайдер при этом не создаётся)."""
        return next((cls.categories for cls in self._classes if cls.source == source), frozenset())

    def download(self, url: str) -> tuple[bytes, str]:
        """Скачивает картинку через клиент провайдера, чей хост совпадает с адресом."""
        return make_downloader(list(self._providers.values()))(url)

    def close(self) -> None:
        for provider in self._providers.values():
            provider.fetcher.close()
        self._providers.clear()
