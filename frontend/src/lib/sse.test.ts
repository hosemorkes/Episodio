import { describe, expect, it } from "vitest";
import { createSseParser, parseAiEvent } from "./sse";

function collect(chunks: string[]): string[] {
  const out: string[] = [];
  const feed = createSseParser((d) => out.push(d));
  chunks.forEach(feed);
  return out;
}

describe("createSseParser", () => {
  it("отдаёт каждое завершённое событие", () => {
    expect(collect(['data: {"chunk":"a"}\n\ndata: {"chunk":"b"}\n\n'])).toEqual(['{"chunk":"a"}', '{"chunk":"b"}']);
  });
  it("склеивает событие, разорванное между кусками (в том числе посреди разделителя и юникода)", () => {
    expect(collect(['data: {"chunk":"При', 'вет"}\n', '\ndata: [DONE]\n\n'])).toEqual(['{"chunk":"Привет"}', "[DONE]"]);
  });
  it("не отдаёт незавершённое событие", () => {
    expect(collect(['data: {"chunk":"a"}\n'])).toEqual([]);
  });
  it("понимает CRLF и пропускает комментарии и пустые события", () => {
    expect(collect([": ping\r\n\r\ndata: x\r\n\r\n"])).toEqual(["x"]);
  });
  it("многострочные data соединяются переводом строки", () => {
    expect(collect(["data: a\ndata: b\n\n"])).toEqual(["a\nb"]);
  });
});

describe("parseAiEvent", () => {
  it("кусок, инструмент, ошибка", () => {
    expect(parseAiEvent('{"chunk":"Привет"}')).toEqual({ chunk: "Привет" });
    expect(parseAiEvent('{"tool":"search_library"}')).toEqual({ tool: "search_library" });
    expect(parseAiEvent('{"error":"сбой"}')).toEqual({ error: "сбой" });
  });
  it("[DONE] — конец потока", () => expect(parseAiEvent("[DONE]")).toBe("done"));
  it("мусор пропускается", () => {
    expect(parseAiEvent("не json")).toBeNull();
    expect(parseAiEvent('{"other":1}')).toBeNull();
    expect(parseAiEvent("null")).toBeNull();
  });
});
