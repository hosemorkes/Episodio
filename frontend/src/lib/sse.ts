/** Разбор потока Server-Sent Events от FastAPI (чистые функции: проверяются тестами без сети) */

/** Событие потока ответа Эпи: кусок текста, вызов инструмента или ошибка; конец потока — отдельный маркер */
export type AiStreamEvent = { chunk: string } | { tool: string } | { error: string };

/**
 * Накопитель SSE: принимает куски текста как есть (граница события может лежать посреди куска)
 * и вызывает onData для каждого завершённого события с содержимым его строк `data:`.
 */
export function createSseParser(onData: (data: string) => void): (text: string) => void {
  let buf = "";
  return (text) => {
    buf += text.replace(/\r\n/g, "\n");
    let end: number;
    while ((end = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, end);
      buf = buf.slice(end + 2);
      const data = block
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).replace(/^ /, ""))
        .join("\n");
      if (data) onData(data);
    }
  };
}

/** Содержимое события -> типизированное событие; "done" — маркер [DONE], null — непонятное событие (пропускаем) */
export function parseAiEvent(data: string): AiStreamEvent | "done" | null {
  if (data.trim() === "[DONE]") return "done";
  try {
    const v = JSON.parse(data) as Record<string, unknown> | null;
    if (v && typeof v.chunk === "string") return { chunk: v.chunk };
    if (v && typeof v.tool === "string") return { tool: v.tool };
    if (v && typeof v.error === "string") return { error: v.error };
  } catch {
    /* не JSON */
  }
  return null;
}
