import { describe, expect, it } from "vitest";
import { dayMark, normDays, type DayRange } from "./highlight";
import { addTeam, addUser, EditError, removeTeam, removeUser, teamOfUser, type TeamsConfig } from "./teamsEdit";
import { isOnVacation, parseVacations, vacationDays } from "./vacations";

describe("vacations", () => {
  it("parses ranges and reports every problem", () => {
    const { vacations, errors } = parseVacations({
      vacations: [
        { user: "bob", from: "2026-09-10", to: "2026-09-11" },
        { user: "alice", from: "2026-09-01", to: "2026-09-02" },
        { user: "", from: "2026-09-01", to: "2026-09-02" },
        { user: "x", from: "2026-02-30", to: "2026-03-01" },
        { user: "y", from: "2026-09-05", to: "2026-09-01" },
      ],
    });
    expect(vacations.map((v) => v.user)).toEqual(["alice", "bob"]);
    expect(errors).toHaveLength(3);
    expect(parseVacations({ nope: 1 }).errors).toHaveLength(1);
  });

  it("expands ranges per user, case-insensitively", () => {
    const days = vacationDays([{ user: "Alice", from: "2026-09-30", to: "2026-10-02" }]);
    expect(isOnVacation(days, "alice", "2026-10-01")).toBe(true);
    expect(isOnVacation(days, "alice", "2026-10-03")).toBe(false);
    expect(isOnVacation(days, "bob", "2026-10-01")).toBe(false);
  });
});

describe("dayMark", () => {
  const range: DayRange = { min: 6, max: 11 };
  const base = { date: "2026-09-02", weekend: false, today: "2026-09-10", vacation: false, range };
  const h = (n: number) => n * 3600;

  it("marks working days outside the range", () => {
    expect(dayMark({ ...base, seconds: h(5) })).toBe("under");
    expect(dayMark({ ...base, seconds: 0 })).toBe("under");
    expect(dayMark({ ...base, seconds: h(6) })).toBe(null);
    expect(dayMark({ ...base, seconds: h(11) })).toBe(null);
    expect(dayMark({ ...base, seconds: h(12) })).toBe("over");
  });

  it("does not mark today, future days or weekends as under, but does mark them over", () => {
    expect(dayMark({ ...base, date: "2026-09-10", seconds: 0 })).toBe(null);
    expect(dayMark({ ...base, date: "2026-09-12", weekend: true, seconds: h(2) })).toBe(null);
    expect(dayMark({ ...base, date: "2026-09-10", seconds: h(13) })).toBe("over");
    expect(dayMark({ ...base, weekend: true, seconds: h(13) })).toBe("over");
  });

  it("shows vacation on working days whatever was logged; no upper limit when max is null", () => {
    expect(dayMark({ ...base, vacation: true, seconds: 0 })).toBe("vacation");
    expect(dayMark({ ...base, vacation: true, seconds: h(20) })).toBe("vacation");
    expect(dayMark({ ...base, range: { min: 8, max: null }, seconds: h(20) })).toBe(null);
  });
});

describe("normDays", () => {
  const vac = vacationDays([{ user: "alice", from: "2026-09-07", to: "2026-09-08" }]);
  it("counts past working days that are not vacation", () => {
    // Sep 2026: 22 working days; Sep 7-8 vacation.
    expect(normDays("2026-09-01", "2026-09-30", "2026-10-06", "alice", vac)).toEqual({ working: 20, vacation: 2 });
    expect(normDays("2026-09-01", "2026-09-30", "2026-10-06", "bob", vac)).toEqual({ working: 22, vacation: 0 });
    // mid-month: only days before today count
    expect(normDays("2026-09-01", "2026-09-30", "2026-09-04", "bob", vac)).toEqual({ working: 3, vacation: 0 });
  });
});

describe("team editing", () => {
  const config: TeamsConfig = { teams: [{ name: "A", users: ["alice"] }, { name: "B", users: [] }] };
  it("adds and removes people, one team per person", () => {
    const added = addUser(config, "B", " bob ");
    expect(added.teams[1].users).toEqual(["bob"]);
    expect(() => addUser(added, "A", "BOB")).toThrow(EditError);
    expect(() => addUser(added, "A", "  ")).toThrow(EditError);
    expect(teamOfUser(removeUser(added, "B", "bob"), "bob")).toBe(null);
  });
  it("adds and removes teams", () => {
    expect(addTeam(config, "C").teams.map((t) => t.name)).toEqual(["A", "B", "C"]);
    expect(() => addTeam(config, "A")).toThrow(EditError);
    expect(removeTeam(config, "A").teams.map((t) => t.name)).toEqual(["B"]);
  });
});
