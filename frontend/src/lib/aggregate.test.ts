import { describe, expect, it } from "vitest";
import { NO_TRACK, buildTree, enrich, idsToDepth, type RowNode } from "./aggregate";
import { visibleDays } from "./calendar";
import { formatDuration, formatPersonDays } from "./format";
import { fixture } from "./fixture";

const entries = enrich(fixture);
const total = entries.reduce((s, e) => s + e.seconds, 0);

function checkSums(nodes: RowNode[]) {
  for (const n of nodes) {
    let byDaySum = 0;
    for (const v of n.byDay.values()) byDaySum += v;
    expect(byDaySum).toBe(n.total);
    if (n.children.length) {
      expect(n.children.reduce((s, c) => s + c.total, 0)).toBe(n.total);
      checkSums(n.children);
    }
  }
}

describe("buildTree", () => {
  for (const dims of [
    ["team", "employee", "issue"],
    ["team", "employee", "track", "issue"],
    ["team", "track", "employee", "issue"],
  ] as const) {
    it(`keeps sums consistent for ${dims.join(" > ")}`, () => {
      const tree = buildTree(fixture, entries, [...dims]);
      expect(tree.reduce((s, n) => s + n.total, 0)).toBe(total);
      checkSums(tree);
    });
  }

  it("shows all configured teams and members, even without worklogs", () => {
    const tree = buildTree(fixture, entries, ["team", "employee", "issue"]);
    expect(tree.map((t) => t.label)).toEqual(["Sensors", "DevOps", "Empty"]);
    expect(tree[0].children.map((c) => c.label)).toEqual(["Alice Smith", "Bob Jones"]);
    expect(tree[2].children).toEqual([]);
    expect(tree[2].total).toBe(0);
  });

  it("sorts issues naturally and tracks with <no SD Track> last", () => {
    const people = buildTree(fixture, entries, ["team", "employee", "issue"]);
    expect(people[0].children[0].children.map((c) => c.key)).toEqual(["SDS-9", "SDS-10"]);
    const teams = buildTree(fixture, entries, ["team", "track"]);
    expect(teams[0].children.map((c) => c.key)).toEqual(["Monitoring", "Platform Migration", NO_TRACK]);
  });

  it("aggregates several worklogs on the same issue and day", () => {
    const tree = buildTree(fixture, entries, ["team", "employee", "issue"]);
    const sds10 = tree[0].children[0].children[1];
    expect(sds10.byDay.get("2026-09-02")).toBe(3.5 * 3600);
    expect(sds10.entries).toHaveLength(3);
  });

  it("expands to a depth", () => {
    const tree = buildTree(fixture, entries, ["team", "employee", "issue"]);
    expect(idsToDepth(tree, 1).size).toBe(2); // Sensors, DevOps (Empty has no children)
    expect(idsToDepth(tree, 2).size).toBe(5);
  });
});

describe("calendar", () => {
  it("hides weekends unless someone logged time on them", () => {
    const days = visibleDays("2026-09-01", "2026-09-07", new Set(["2026-09-06"]));
    expect(days.map((d) => d.date)).toEqual([
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-06",
      "2026-09-07",
    ]);
    expect(days[4].weekend).toBe(true);
    expect(days[0].label).toBe("Sep 1");
  });

  it("marks the first visible day of each week", () => {
    const withSunday = visibleDays("2026-09-01", "2026-09-14", new Set(["2026-09-06"]));
    const starts = withSunday.filter((d) => d.weekStart).map((d) => d.date);
    expect(starts).toEqual(["2026-09-07", "2026-09-14"]);
    // a week whose Monday is hidden still starts at its first visible day
    const fromWeekend = visibleDays("2026-09-05", "2026-09-08", new Set(["2026-09-06"]));
    expect(fromWeekend.map((d) => [d.date, d.weekStart])).toEqual([
      ["2026-09-06", false],
      ["2026-09-07", true],
      ["2026-09-08", false],
    ]);
  });
});

describe("format", () => {
  it("formats durations without zeroes", () => {
    expect(formatDuration(0)).toBe("");
    expect(formatDuration(45 * 60)).toBe("45m");
    expect(formatDuration(8 * 3600)).toBe("8h");
    expect(formatDuration(7.5 * 3600)).toBe("7h 30m");
    expect(formatDuration(142 * 3600 + 15 * 60)).toBe("142h 15m");
  });

  it("formats person-days", () => {
    expect(formatPersonDays(12 * 3600, 8)).toBe("1.50");
    expect(formatPersonDays(0, 8)).toBe("");
  });
});
