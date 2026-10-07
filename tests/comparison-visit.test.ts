import { describe, expect, it } from "vitest";
import { enterComparisonVisit } from "../src/features/measurement/comparison-visit";

describe("comparison visit measurement intent", () => {
  it("does not replay a pre-consent visit after grant, but tracks a new granted visit", () => {
    const firstVisit = enterComparisonVisit(undefined, "cmp_first", "unknown");
    expect(firstVisit).toEqual({ lastVisitedId: "cmp_first", emitViewEvent: false });

    const afterGrantOnSameVisit = enterComparisonVisit(firstVisit.lastVisitedId, "cmp_first", "granted");
    expect(afterGrantOnSameVisit).toEqual({ lastVisitedId: "cmp_first", emitViewEvent: false });

    const newGrantedVisit = enterComparisonVisit(afterGrantOnSameVisit.lastVisitedId, "cmp_second", "granted");
    expect(newGrantedVisit).toEqual({ lastVisitedId: "cmp_second", emitViewEvent: true });
  });

  it("tracks a page visit whose existing consent cookie was hydrated before entry", () => {
    expect(enterComparisonVisit(undefined, "cmp_first", "granted")).toEqual({
      lastVisitedId: "cmp_first",
      emitViewEvent: true,
    });
  });
});
