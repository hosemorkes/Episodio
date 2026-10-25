import { describe, expect, it } from "vitest";
import { randomPeriod, topFor } from "./showcase";

describe("showcase", () => {
  it("топ не длиннее 4 и отсортирован по оценке", () => {
    const top = topFor("anime", 2024, 0);
    expect(top.length).toBeLessThanOrEqual(4);
    for (let i = 1; i < top.length; i++) expect(top[i - 1].r).toBeGreaterThanOrEqual(top[i].r);
  });
  it("в топе нет повторяющихся названий", () => {
    const top = topFor("series", 2023, 0);
    expect(new Set(top.map((x) => x.t)).size).toBe(top.length);
  });
  it("случайный период всегда непустой", () => {
    for (let i = 0; i < 30; i++) {
      const { cat, year, month } = randomPeriod();
      expect(topFor(cat, year, month).length).toBeGreaterThan(0);
    }
  });
});
