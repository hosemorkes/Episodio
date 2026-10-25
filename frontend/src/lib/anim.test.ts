import { describe, expect, it } from "vitest";
import { easeOutCubic, staggered } from "./anim";

describe("staggered", () => {
  it("до старта элемента прогресс нулевой", () => expect(staggered(0.05, 2)).toBe(0));
  it("по завершении равен 1", () => expect(staggered(1, 4)).toBe(1));
  it("поздние элементы отстают от ранних", () => expect(staggered(0.4, 0)).toBeGreaterThan(staggered(0.4, 3)));
});

describe("easeOutCubic", () => {
  it("границы", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });
});
