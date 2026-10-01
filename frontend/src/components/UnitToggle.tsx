import type { Unit } from "../lib/format";

export function UnitToggle({
  unit,
  onChange,
  hoursPerPersonDay,
}: {
  unit: Unit;
  onChange: (u: Unit) => void;
  hoursPerPersonDay: number;
}) {
  return (
    <>
      <span className="muted">Units:</span>
      <div className="segmented small">
        <button className={unit === "hours" ? "on" : ""} onClick={() => onChange("hours")}>
          Hours
        </button>
        <button className={unit === "personDays" ? "on" : ""} onClick={() => onChange("personDays")}>
          Person-days
        </button>
        <button
          className={unit === "percent" ? "on" : ""}
          onClick={() => onChange("percent")}
          title="Share of the team's logged time in the same column"
        >
          % of team
        </button>
      </div>
      <span className="muted">
        {unit === "percent" ? "share of the team's logged time in the same column" : `1 person-day = ${hoursPerPersonDay}h`}
      </span>
    </>
  );
}
