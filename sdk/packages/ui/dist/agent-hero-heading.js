import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { cx } from "./utils.js";
const DEFAULT_VERBS = ["build", "create", "fix", "know"];
/** The shared Cline welcome heading used by agent start surfaces. */
export function AgentHeroHeading({ className, cycleMs = 2600, verbs = DEFAULT_VERBS, }) {
    const availableVerbs = verbs.filter((verb) => verb.trim().length > 0);
    const [verbIndex, setVerbIndex] = useState(0);
    useEffect(() => {
        if (availableVerbs.length <= 1)
            return;
        const reduceMotion = typeof window.matchMedia === "function" &&
            window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (reduceMotion)
            return;
        const interval = window.setInterval(() => {
            setVerbIndex((current) => (current + 1) % availableVerbs.length);
        }, cycleMs);
        return () => window.clearInterval(interval);
    }, [availableVerbs.length, cycleMs]);
    const verb = availableVerbs[verbIndex % availableVerbs.length] ?? "build";
    return (_jsxs("h1", { className: cx("cline-ui-hero-heading", className), children: [_jsx("span", { className: "cline-ui-sr-only", children: "What would you like to build?" }), _jsxs("span", { "aria-hidden": "true", children: ["What would you like to", " ", _jsx("span", { className: "cline-ui-hero-heading__word", children: verb.split("").map((character, index) => (_jsx("span", { className: "cline-ui-hero-heading__character", style: { animationDelay: `${index * 45}ms` }, children: character }, `${verb}-${index}`))) }, verb), "?"] })] }));
}
//# sourceMappingURL=agent-hero-heading.js.map