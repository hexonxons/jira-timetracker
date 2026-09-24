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
      </div>
      <span className="muted">1 person-day = {hoursPerPersonDay}h</span>
    </>
  );
}
