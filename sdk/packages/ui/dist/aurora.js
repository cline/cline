import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo } from "react";
import { cx } from "./utils.js";
function seededUnit(index, salt) {
    let value = Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b);
    value ^= value >>> 16;
    value = Math.imul(value, 0x7feb352d);
    value ^= value >>> 15;
    value = Math.imul(value, 0x846ca68b);
    value ^= value >>> 16;
    return (value >>> 0) / 0x1_0000_0000;
}
export function AgentAurora({ className, starCount = 36 }) {
    const stars = useMemo(() => Array.from({ length: starCount }, (_, index) => {
        const vertical = seededUnit(index, 1);
        const size = seededUnit(index, 3);
        return {
            delay: `${seededUnit(index, 4) * -5}s`,
            duration: `${3.5 + seededUnit(index, 5) * 3.5}s`,
            left: `${seededUnit(index, 2) * 100}%`,
            opacity: 0.3 + seededUnit(index, 6) * 0.55,
            size: size < 0.18 ? 4 : size < 0.55 ? 3 : 2,
            top: `${100 - (1 - vertical * vertical) * 48}%`,
        };
    }), [starCount]);
    return (_jsxs("div", { "aria-hidden": "true", className: cx("cline-ui-aurora", className), children: [_jsx("div", { className: "cline-ui-aurora__horizon" }), _jsx("div", { className: "cline-ui-aurora__current cline-ui-aurora__current--left" }), _jsx("div", { className: "cline-ui-aurora__current cline-ui-aurora__current--right" }), _jsx("div", { className: "cline-ui-aurora__blob cline-ui-aurora__blob--left" }), _jsx("div", { className: "cline-ui-aurora__blob cline-ui-aurora__blob--right" }), stars.map((star) => (_jsx("span", { className: "cline-ui-aurora__star", style: {
                    animationDelay: star.delay,
                    animationDuration: star.duration,
                    height: star.size,
                    left: star.left,
                    opacity: star.opacity,
                    top: star.top,
                    width: star.size,
                } }, `${star.left}-${star.top}-${star.delay}-${star.duration}`)))] }));
}
//# sourceMappingURL=aurora.js.map