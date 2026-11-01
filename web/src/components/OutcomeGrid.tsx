// Tasks x init states: one square per episode. The same grid encodes single runs (success / failure) and
// paired comparisons (only A, only B, both, neither).
import { shortTask } from "../api";
import { Meter } from "./parts";

export interface Cell { key: string; task_id: string; seed: number; cls: string; title: string }

export function OutcomeGrid({ cells, onPick, current, rates }: { cells: Cell[]; onPick?: (c: Cell) => void; current?: string; rates?: Record<string, number> }) {
  const tasks = [...new Set(cells.map((c) => c.task_id))].sort();
  const seeds = [...new Set(cells.map((c) => c.seed))].sort((a, b) => a - b);
  const at = new Map(cells.map((c) => [`${c.task_id}#${c.seed}`, c]));
  return (
    <div className="scroll-x">
      <div className="og" style={{ gridTemplateColumns: `minmax(160px, 380px) repeat(${seeds.length}, 15px)${rates ? " 150px" : ""}` }}>
        <span className="label">task \ init state</span>
        {seeds.map((s, i) => <span key={s} className="label" style={{ fontSize: 9, textAlign: "center", letterSpacing: 0 }}>{i % 5 === 0 ? s : ""}</span>)}
        {rates && <span className="label rate">success</span>}
        {tasks.map((t) => [
          <span key={t} className="tn" title={t}>{shortTask(t)}</span>,
          ...seeds.map((s) => {
            const c = at.get(`${t}#${s}`);
            return c ? <button key={t + s} className={`cell ${c.cls} ${current === c.key ? "cur" : ""}`} title={c.title} aria-label={c.title} onClick={() => onPick?.(c)} />
              : <span key={t + s} />;
          }),
          ...(rates ? [<span key={t + "r"} className="rate"><Meter value={rates[t]} good /></span>] : []),
        ])}
      </div>
    </div>
  );
}
