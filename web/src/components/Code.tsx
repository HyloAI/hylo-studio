// Monospace code with a small Python highlighter (comments, strings, keywords, numbers, definitions) and line numbers.
import { ReactNode } from "react";

const KW = new Set(("and as assert async await break class continue def del elif else except finally for from global if import " +
  "in is lambda nonlocal not or pass raise return try while with yield match case").split(" "));
const CONST = new Set(["True", "False", "None", "self"]);
const BUILTIN = new Set(("print len range enumerate zip min max sum abs round sorted list dict set tuple str int float bool " +
  "isinstance any all map filter open super getattr hasattr").split(" "));
// one token per match: comment | triple string | string | number | word | other
const TOK = /(#[^\n]*)|("""[\s\S]*?"""|'''[\s\S]*?''')|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|(\b\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|([\s\S])/g;

function highlight(src: string): ReactNode[][] {
  // split into lines of spans, so line numbers stay aligned even inside multi-line strings
  const lines: ReactNode[][] = [[]];
  let prev = "";
  let k = 0;
  const push = (text: string, cls?: string) => {
    const parts = text.split("\n");
    parts.forEach((p, i) => {
      if (i > 0) lines.push([]);
      if (p) lines[lines.length - 1].push(cls ? <span key={k++} className={cls}>{p}</span> : p);
    });
  };
  for (const m of src.matchAll(TOK)) {
    const [t, com, tri, str, num, word] = m;
    if (com) push(t, "c-com");
    else if (tri || str) push(t, "c-str");
    else if (num) push(t, "c-num");
    else if (word) {
      if (prev === "def" || prev === "class") push(t, "c-def");
      else if (KW.has(t)) push(t, "c-kw");
      else if (CONST.has(t)) push(t, "c-const");
      else if (BUILTIN.has(t)) push(t, "c-bi");
      else push(t);
      prev = t;
      continue;
    } else push(t);
    if (!/^\s+$/.test(t)) prev = "";
  }
  return lines;
}

export function Code({ src, lang = "python", numbers = true, max = 420 }: { src: string; lang?: string; numbers?: boolean; max?: number | null }) {
  const lines = lang === "python" ? highlight(src.replace(/\s+$/, "")) : src.replace(/\s+$/, "").split("\n").map((l) => [l]);
  return (
    <pre className={`code ${numbers ? "numbered" : ""}`} style={max ? { maxHeight: max } : undefined}>
      {lines.map((l, i) => <span className="ln" key={i}>{l.length ? l : " "}{"\n"}</span>)}
    </pre>
  );
}
