// The world page (RFC-0008): a stage and the world built from it, a free view to orbit, robot actions by hand, and a
// chat with a model that builds and runs the world through the same tools (`hylo world chat` behind the scenes).
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { post, useApi } from "../api";
import { Err, Loading, PageHead, Panel } from "../components/parts";

export { WorldStage } from "./WorldStudio";

export function Worlds() {
  const [stages, err, reload] = useApi<any[]>("/api/world/stages");
  const [name, setName] = useState("");
  const nav = useNavigate();
  if (err) return <Err e={err} />;
  if (!stages) return <Loading what="stages" />;
  const create = async () => {
    if (!name) return;
    await post("/api/world/stages", { name });
    nav(`/world/${encodeURIComponent(name)}`);
  };
  return (
    <>
      <PageHead title="World" />
      <div className="row" style={{ marginBottom: 14 }}>
        <input placeholder="new stage name (lower case)" value={name} onChange={(e) => setName(e.target.value.toLowerCase())}
          style={{ maxWidth: 260 }} />
        <button className="btn go" onClick={create} disabled={!/^[a-z][a-z0-9_]*$/.test(name)}>Create stage</button>
        <button className="btn" onClick={reload}>Refresh</button>
      </div>
      <Panel flush>
        <table className="tbl">
          <thead><tr><th>stage</th><th className="r">revision</th><th className="r">entities</th><th>chat</th></tr></thead>
          <tbody>{stages.map((s) => (
            <tr key={s.name} className="click" onClick={() => nav(`/world/${encodeURIComponent(s.name)}`)}>
              <td>{s.name}</td><td className="r num">{s.revision}</td><td className="r num">{s.entities}</td>
              <td className="faint">{s.chat ? "running" : ""}</td>
            </tr>))}</tbody>
        </table>
        {!stages.length && <div className="empty-state">No stages yet: create one, then ask the model to build a scene.</div>}
      </Panel>
    </>
  );
}
