import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard, useRenderer } from "@opentui/react";
import { useState, useCallback } from "react";

function rightTriangle(n: number): string[] {
  const rows: string[] = [];
  for (let i = 1; i <= n; i++) rows.push("★ ".repeat(i).trimEnd());
  return rows;
}
function leftTriangle(n: number): string[] {
  const rows: string[] = [];
  for (let i = 1; i <= n; i++)
    rows.push(" ".repeat((n - i) * 2) + "★ ".repeat(i).trimEnd());
  return rows;
}
function pyramid(n: number): string[] {
  const rows: string[] = [];
  for (let i = 1; i <= n; i++)
    rows.push(" ".repeat(n - i) + "★ ".repeat(i).trimEnd());
  return rows;
}
function diamond(n: number): string[] {
  const rows: string[] = [];
  for (let i = 1; i <= n; i++)
    rows.push(" ".repeat(n - i) + "★ ".repeat(i).trimEnd());
  for (let i = n - 1; i >= 1; i--)
    rows.push(" ".repeat(n - i) + "★ ".repeat(i).trimEnd());
  return rows;
}
function hollowSquare(n: number): string[] {
  const rows: string[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0 || i === n - 1) rows.push(("★ ".repeat(n)).trimEnd());
    else rows.push("★ " + "  ".repeat(n - 2) + "★");
  }
  return rows;
}
function invertedTriangle(n: number): string[] {
  const rows: string[] = [];
  for (let i = n; i >= 1; i--) rows.push("★ ".repeat(i).trimEnd());
  return rows;
}
function hourglass(n: number): string[] {
  const rows: string[] = [];
  for (let i = n; i >= 1; i--)
    rows.push(" ".repeat(n - i) + "★ ".repeat(i).trimEnd());
  for (let i = 2; i <= n; i++)
    rows.push(" ".repeat(n - i) + "★ ".repeat(i).trimEnd());
  return rows;
}
function xPattern(n: number): string[] {
  const size = n * 2 - 1;
  const rows: string[] = [];
  for (let i = 0; i < size; i++) {
    let row = "";
    for (let j = 0; j < size; j++)
      row += j === i || j === size - 1 - i ? "★" : " ";
    rows.push(row);
  }
  return rows;
}
function checkerboard(n: number): string[] {
  const rows: string[] = [];
  for (let i = 0; i < n; i++) {
    let row = "";
    for (let j = 0; j < n; j++)
      row += (i + j) % 2 === 0 ? "★ " : "  ";
    rows.push(row.trimEnd());
  }
  return rows;
}

const PATTERNS = [
  { name: "Right Triangle",    desc: "Grows right from the left edge",       gen: rightTriangle    },
  { name: "Left Triangle",     desc: "Grows right, aligned to the right",    gen: leftTriangle     },
  { name: "Pyramid",           desc: "Centred equilateral triangle",         gen: pyramid          },
  { name: "Diamond",           desc: "Pyramid + inverted pyramid",           gen: diamond          },
  { name: "Hollow Square",     desc: "Square border only",                   gen: hollowSquare     },
  { name: "Inverted Triangle", desc: "Full row at top, shrinks downward",    gen: invertedTriangle },
  { name: "Hourglass",         desc: "Diamond turned on its side",           gen: hourglass        },
  { name: "X Pattern",         desc: "Two diagonals crossing",               gen: xPattern         },
  { name: "Checkerboard",      desc: "Alternating star/space grid",          gen: checkerboard     },
];

const MIN_SIZE = 3;
const MAX_SIZE = 12;

function App() {
  const renderer = useRenderer();
  const [selected, setSelected] = useState(0);
  const [size, setSize] = useState(7);

  useKeyboard(useCallback((key) => {
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      renderer.destroy();
      return;
    }
    if (key.name === "up" || key.name === "left")
      setSelected(s => (s - 1 + PATTERNS.length) % PATTERNS.length);
    if (key.name === "down" || key.name === "right")
      setSelected(s => (s + 1) % PATTERNS.length);
    if (key.name >= "1" && key.name <= "9") {
      const idx = parseInt(key.name, 10) - 1;
      if (idx < PATTERNS.length) setSelected(idx);
    }
    if (key.name === "=" || key.name === "+")
      setSize(s => Math.min(s + 1, MAX_SIZE));
    if (key.name === "-")
      setSize(s => Math.max(s - 1, MIN_SIZE));
  }, [renderer]));

  const pat = PATTERNS[selected];
  const lines = pat.gen(size);
  const starCount = lines.join("").split("★").length - 1;
  const maxWidth = Math.max(...lines.map(l => l.length));

  const BG = "#0d0f18"; const PANEL = "#13162b"; const BORDER = "#3b4261";
  const GOLD = "#f7c948"; const CYAN = "#7dcfff"; const PURPLE = "#bb9af7";
  const GREEN = "#9ece6a"; const DIM = "#414868"; const WHITE = "#c0caf5";

  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={BG} padding={1}>
      <box flexDirection="row" justifyContent="center" marginBottom={1}>
        <ascii-font font="tiny" text="Star Patterns" color={GOLD} />
      </box>
      <box flexDirection="row" flexGrow={1}>
        <box flexDirection="column" width={26} border borderColor={BORDER}
             backgroundColor={PANEL} padding={1} marginRight={1}>
          <text fg={CYAN}>{" Patterns\n"}</text>
          {PATTERNS.map((p, i) => (
            <box key={i} backgroundColor={i === selected ? PURPLE : "transparent"} paddingLeft={1}>
              <text fg={i === selected ? "#1a1b26" : WHITE}>{`${i + 1}. ${p.name}`}</text>
            </box>
          ))}
          <text fg={DIM}>{"\n ↑↓ or 1-9 to select"}</text>
        </box>
        <box flexDirection="column" flexGrow={1} border borderColor={BORDER}
             backgroundColor={PANEL} padding={1} marginRight={1}>
          <box flexDirection="row" marginBottom={1}>
            <text fg={GOLD}>{pat.name}</text>
            <text fg={DIM}>{"  —  "}</text>
            <text fg={WHITE}>{pat.desc}</text>
          </box>
          {lines.map((line, i) => <text key={i} fg={GOLD}>{line}</text>)}
        </box>
        <box flexDirection="column" width={22} border borderColor={BORDER}
             backgroundColor={PANEL} padding={1}>
          <text fg={CYAN}>{" Controls\n"}</text>
          <text fg={GREEN}>{"Size: "}</text>
          <text fg={GOLD}>{`  ${size} / ${MAX_SIZE}`}</text>
          <text fg={DIM}>{`\n ${"\u2588".repeat(size - MIN_SIZE + 1)}${"\u2591".repeat(MAX_SIZE - size)}\n`}</text>
          <text fg={CYAN}>{"\n Shortcuts\n"}</text>
          <text fg={DIM}>{"  ↑↓  prev/next\n"}</text>
          <text fg={DIM}>{"  ←→  prev/next\n"}</text>
          <text fg={DIM}>{"  1-9  jump to #\n"}</text>
          <text fg={DIM}>{"  +/-  size\n"}</text>
          <text fg={DIM}>{"  q  quit\n"}</text>
          <text fg={CYAN}>{"\n Stats\n"}</text>
          <text fg={DIM}>{`  Rows : ${lines.length}\n`}</text>
          <text fg={DIM}>{`  Stars: ${starCount}\n`}</text>
          <text fg={DIM}>{`  Width: ${maxWidth}\n`}</text>
        </box>
      </box>
    </box>
  );
}

const renderer = await createCliRenderer({ exitOnCtrlC: false });
createRoot(renderer).render(<App />);
