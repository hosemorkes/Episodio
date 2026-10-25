import { DICT } from "./dict";
import type { Lang } from "./types";

// Строки, добавленные после прототипа
const EXTRA: Record<string, string> = {
  "Доброе утро": "Good morning",
  "Добрый день": "Good afternoon",
  "Доброй ночи": "Good night",
  "Загрузка…": "Loading…",
  "Библиотека пуста": "Your library is empty",
  "Добавьте первый тайтл, чтобы начать отслеживать прогресс.": "Add your first title to start tracking progress.",
  "Тайтл не найден": "Title not found",
  "Последняя рецензия": "Latest review",
  "Число не меньше нуля": "Number must be zero or more",
  "Всего не меньше 1": "Total must be at least 1",
  "Больше, чем всего": "More than the total",
  "Точно удалить?": "Delete for sure?",
  // Категории
  "Мультсериал": "Cartoon",
  "Мультсериалы": "Cartoons",
  "ТВ-шоу": "TV show",
  "Аудиокнига": "Audiobook",
  "Аудиокниги": "Audiobooks",
  // Аудиокниги: подписи статусов и прогресса
  "Слушаю": "Listening",
  "Прослушано": "Listened",
  "Все главы прослушаны": "All chapters listened",
  "Прослушано глав": "Chapters listened",
  // Поля из БД: том, автор, озвучка, ссылка
  "Т": "V",
  "Том": "Volume",
  "Том ": "Volume ",
  "Автор": "Author",
  "Озвучка / перевод": "Voice-over / translation",
  "Озвучка": "Voice-over",
  "Ссылка": "Link",
  "Ссылка на источник": "Source link",
  "Ссылка должна начинаться с http:// или https://": "Link must start with http:// or https://",
  "Открыть источник": "Open source",
  // Живой поиск по каталогам
  "Найдено в каталогах": "Found in catalogs",
  "В подборке: ": "In the selection: ",
  "Ищем в каталогах…": "Searching catalogs…",
  "В каталогах ничего не найдено": "Nothing found in catalogs",
  "Часть источников недоступна: ": "Some sources are unavailable: ",
  "Не удалось выполнить поиск": "Search failed",
  "В подборке пока нет этой категории. Введите название в строке поиска, и тайтл найдётся во внешних каталогах.": "This category is not in the selection yet. Type a title in the search box to find it in external catalogs.",
  // Работа с сервером
  "Не удалось выполнить действие": "Action failed",
  "Не удалось загрузить данные": "Could not load data",
  "Не удалось загрузить данные: ": "Could not load data: ",
  "Повторить": "Retry",
  "Тайтл сохранён, но постер не загрузился": "Title saved, but the poster failed to upload",
  "Загружено: ": "Imported: ",
  "уже были: ": "already there: ",
  "с ошибкой: ": "failed: ",
  "Пока нет отметок. Отметьте серию или главу, и она появится здесь.": "No activity yet. Mark an episode or chapter and it will show up here.",
  // Заметка вместо отзывов
  "ЗАМЕТКА": "NOTE",
  "Заметка": "Note",
  "Заметка сохранена": "Note saved",
  "Заметка удалена": "Note deleted",
  "Сохранить заметку": "Save note",
  "Ваши впечатления, рецензия или заметка": "Your impressions, review or note",
  "Последняя заметка": "Latest note",
};

/** Перевод без React: ключ — русская строка, нет перевода — возвращаем как есть */
export const translate = (lang: Lang, ru: string) => (lang === "en" && (DICT[ru] || EXTRA[ru])) || ru;
