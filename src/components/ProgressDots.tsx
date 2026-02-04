import type { Step } from "../lib/types";

export function ProgressDots({ step }: { step: Step }) {
  const dots: Step[] = [0,1,2,3,4,5];
  return (
    <div className="progress" aria-label="progress">
      {dots.map((d) => (
        <div key={d} className={"dot" + (d === step ? " on" : "")} />
      ))}
    </div>
  );
}
