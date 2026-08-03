// Real-host scroll benchmark (V14 §2.6 / P2 "真实宿主 E2E Benchmark")
//
// Drives the debug-harness server (apps/vscode/src/dev/debug-harness/server.ts)
// to: open the sidebar, inject N synthetic messages into the webview, run a
// scripted scroll while sampling requestAnimationFrame timestamps + JS heap,
// then compute FPS/jank/memory metrics from benchmark-metrics.ts.
//
// Usage (harness must already be running on localhost:19229):
//   bun run src/dev/debug-harness/benchmark/run-scroll-benchmark.ts [--messages 100] [--duration 3000] [--port 19229] [--budget-mb 200]
//
// Exit code 0 = PASS, 1 = FAIL (metrics below threshold or harness error).

import { checkMemoryBudget, computeScrollBenchmark, type FrameSample, type MemorySample } from "./benchmark-metrics"

interface CliArgs {
	messages: number
	durationMs: number
	port: number
	budgetMB: number
	minP95Fps: number
	maxJankRate: number
}

function parseArgs(argv: string[]): CliArgs {
	const args: CliArgs = {
		messages: 100,
		durationMs: 3000,
		port: 19229,
		budgetMB: 200,
		minP95Fps: 30,
		maxJankRate: 0.1,
	}
	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i]
		const value = () => Number(argv[++i])
		switch (flag) {
			case "--messages":
				args.messages = value()
				break
			case "--duration":
				args.durationMs = value()
				break
			case "--port":
				args.port = value()
				break
			case "--budget-mb":
				args.budgetMB = value()
				break
			case "--min-p95-fps":
				args.minP95Fps = value()
				break
			case "--max-jank-rate":
				args.maxJankRate = value()
				break
			default:
				console.warn(`[benchmark] Ignoring unknown flag: ${flag}`)
		}
	}
	return args
}

interface HarnessResponse {
	error?: string
	[key: string]: unknown
}

async function callHarness(port: number, method: string, params: Record<string, unknown> = {}): Promise<HarnessResponse> {
	const response = await fetch(`http://localhost:${port}/api`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ method, params }),
	})
	if (!response.ok) {
		throw new Error(`Harness ${method} failed: HTTP ${response.status}`)
	}
	const body = (await response.json()) as HarnessResponse
	if (body.error) {
		throw new Error(`Harness ${method} error: ${body.error}`)
	}
	return body
}

/**
 * Webview-side instrumentation injected via web.evaluate. Builds synthetic
 * messages, scrolls the container, and records rAF frame durations + heap
 * samples into window.__clineBench. Wrapped in an IIFE because web.evaluate
 * evaluates a single expression.
 */
function buildInjectScript(messages: number, durationMs: number): string {
	const script = `
(() => {
	const target = messages;
	const duration = durationMs;
	const findScroller = () => {
		const candidates = Array.from(document.querySelectorAll("*")).filter((el) => el.scrollHeight > el.clientHeight + 100);
		return candidates.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0] || document.body;
	};
	const scroller = findScroller();
	if (!scroller) return { error: "no scroll container found" };
	// Inject synthetic user/assistant message rows (lightweight, mirrors ChatRow density).
	const fragment = document.createDocumentFragment();
	for (let i = 0; i < target; i++) {
		const row = document.createElement("div");
		row.setAttribute("data-benchmark-message", String(i));
		row.style.padding = "12px 16px";
		row.style.borderBottom = "1px solid rgba(128,128,128,0.15)";
		row.textContent = "Synthetic message " + i + " — " + "lorem ipsum ".repeat(8) + i;
		fragment.appendChild(row);
	}
	scroller.appendChild(fragment);
	const frames = [];
	const memory = [];
	let rafId = 0;
	let last = performance.now();
	let running = true;
	const sample = (now) => {
		if (!running) return;
		const durationMsNow = now - last;
		last = now;
		frames.push({ timestampMs: now, frameDurationMs: durationMsNow });
		if (performance.memory && typeof performance.memory.usedJSHeapSize === "number") {
			memory.push({ usedMB: performance.memory.usedJSHeapSize / (1024 * 1024), timestampMs: now });
		}
		// Ping-pong scroll to force layout + virtualization churn.
		const max = scroller.scrollHeight - scroller.clientHeight;
		const t = (now / 400) % 1;
		scroller.scrollTop = Math.round(t * max);
		if (now - startTime < duration) {
			rafId = requestAnimationFrame(sample);
		} else {
			running = false;
			window.__clineBench = { frames, memory, scrollHeight: scroller.scrollHeight };
		}
	};
	const startTime = performance.now();
	rafId = requestAnimationFrame(sample);
	return { started: true, scroller: scroller.className || scroller.tagName, messageRows: target };
})()`
	return script.replaceAll("messages", String(messages)).replaceAll("durationMs", String(durationMs))
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2))

	console.log(`[benchmark] Connecting to harness on :${args.port}`)
	const status = await callHarness(args.port, "status")
	console.log(`[benchmark] Harness status: clineDir=${status.clineDir ?? "unknown"}`)

	await callHarness(args.port, "ui.open_sidebar")
	console.log("[benchmark] Sidebar opened")

	const injectResult = await callHarness(args.port, "web.evaluate", {
		expression: buildInjectScript(args.messages, args.durationMs),
	})
	console.log("[benchmark] Injection:", JSON.stringify(injectResult))

	// Wait for the rAF loop to finish (duration + settling).
	await new Promise((resolve) => setTimeout(resolve, args.durationMs + 1000))

	const collected = await callHarness(args.port, "web.evaluate", {
		expression: "window.__clineBench ? JSON.stringify(window.__clineBench) : 'null'",
	})
	let bench: { frames: FrameSample[]; memory: MemorySample[] } | null = null
	if (typeof collected === "string" && collected !== "null") {
		bench = JSON.parse(collected)
	}

	if (!bench || !Array.isArray(bench.frames) || bench.frames.length === 0) {
		console.error("[benchmark] FAIL: no frame samples collected — is the Cline sidebar open?")
		process.exit(1)
	}

	const framesResult = computeScrollBenchmark(bench.frames, {
		minP95Fps: args.minP95Fps,
		maxJankRate: args.maxJankRate,
	})
	const memoryResult = checkMemoryBudget(bench.memory, args.budgetMB)

	console.log("\n===== SCROLL BENCHMARK =====")
	console.log(framesResult.summary)
	console.log(memoryResult.summary)
	console.log("===========================\n")

	const report = {
		meta: { messages: args.messages, durationMs: args.durationMs, timestamp: new Date().toISOString() },
		frames: framesResult,
		memory: memoryResult,
	}
	console.log(JSON.stringify(report, null, 2))

	const passed = framesResult.pass && memoryResult.withinBudget
	process.exit(passed ? 0 : 1)
}

main().catch((error) => {
	console.error("[benchmark] Fatal:", error)
	process.exit(1)
})
