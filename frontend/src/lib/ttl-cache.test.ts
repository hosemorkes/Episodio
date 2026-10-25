import { describe, expect, it } from "vitest";
import { createTtlCache } from "./ttl-cache";

describe("createTtlCache", () => {
  it("возвращает значение до истечения срока и забывает после", () => {
    let now = 1000;
    const cache = createTtlCache<string>(500, () => now);
    cache.set("a", "x");
    expect(cache.get("a")).toBe("x");
    now += 499;
    expect(cache.get("a")).toBe("x");
    now += 1;
    expect(cache.get("a")).toBeUndefined();
  });
  it("повторная запись продлевает срок, ключи независимы", () => {
    let now = 0;
    const cache = createTtlCache<number>(100, () => now);
    cache.set("a", 1);
    now = 90;
    cache.set("a", 2);
    cache.set("b", 3);
    now = 150;
    expect(cache.get("a")).toBe(2);
    expect(cache.get("b")).toBe(3);
    expect(cache.get("c")).toBeUndefined();
  });
  it("clear очищает всё", () => {
    const cache = createTtlCache<number>(100, () => 0);
    cache.set("a", 1);
    cache.clear();
    expect(cache.get("a")).toBeUndefined();
  });
});
