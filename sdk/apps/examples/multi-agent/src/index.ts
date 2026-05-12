import { Agent } from "@cline/sdk";
import { createServer } from "node:http";

const PORT = Number(process.env.PORT || 3456);

const HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Multi-Agent Fan-Out</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: #0a0a0a; color: #e5e5e5; height: 100vh; display: flex; flex-direction: column; }
  header { padding: 16px 24px; border-bottom: 1px solid #262626; }
  header h1 { font-size: 16px; font-weight: 500; }
  header p { font-size: 13px; color: #737373; margin-top: 4px; }
  .container { flex: 1; display: flex; flex-direction: column; padding: 24px; gap: 16px; overflow: hidden; }
  .input-row { display: flex; gap: 8px; }
  .input-row input { flex: 1; padding: 10px 14px; background: #171717; border: 1px solid #262626; border-radius: 8px; color: #e5e5e5; font-size: 14px; outline: none; }
  .input-row input:focus { border-color: #525252; }
  .input-row button { padding: 10px 20px; background: #e5e5e5; color: #0a0a0a; border: none; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; }
  .input-row button:disabled { opacity: 0.4; cursor: not-allowed; }
  .agents { flex: 1; display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; overflow-y: auto; }
  .agent-card { background: #171717; border: 1px solid #262626; border-radius: 8px; padding: 16px; display: flex; flex-direction: column; }
  .agent-card .agent-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .agent-card .agent-name { font-size: 13px; font-weight: 600; }
  .agent-card .agent-status { font-size: 11px; padding: 2px 8px; border-radius: 9999px; }
  .status-running { background: #172554; color: #60a5fa; }
  .status-done { background: #14532d; color: #4ade80; }
  .status-error { background: #450a0a; color: #f87171; }
  .agent-card .agent-output { flex: 1; font-size: 13px; line-height: 1.6; white-space: pre-wrap; overflow-y: auto; color: #a3a3a3; }
  .summary { background: #171717; border: 1px solid #262626; border-radius: 8px; padding: 16px; font-size: 14px; line-height: 1.6; white-space: pre-wrap; display: none; }
  .summary.visible { display: block; }
  .summary h3 { font-size: 13px; font-weight: 600; margin-bottom: 8px; color: #e5e5e5; }
</style>
</head>
<body>
<header>
  <h1>Multi-Agent Fan-Out</h1>
  <p>Enter a topic. Three specialist agents research it in parallel, then a synthesizer combines their findings.</p>
</header>
<div class="container">
  <div class="input-row">
    <input id="topic" type="text" placeholder="e.g. How do modern CPUs handle branch prediction?" autofocus />
    <button id="go" onclick="run()">Go</button>
  </div>
  <div class="agents" id="agents"></div>
  <div class="summary" id="summary"><h3>Synthesized Answer</h3><div id="summary-text"></div></div>
</div>
<script>
async function run() {
  const topic = document.getElementById('topic').value.trim();
  if (!topic) return;
  document.getElementById('go').disabled = true;
  document.getElementById('agents').innerHTML = '';
  document.getElementById('summary').classList.remove('visible');
  document.getElementById('summary-text').textContent = '';

  const es = new EventSource('/run?topic=' + encodeURIComponent(topic));
  const cards = {};

  es.onmessage = (e) => {
    const data = JSON.parse(e.data);

    if (data.type === 'agent-start') {
      const card = document.createElement('div');
      card.className = 'agent-card';
      card.id = 'card-' + data.agentId;
      card.innerHTML =
        '<div class="agent-header"><span class="agent-name">' + data.role + '</span><span class="agent-status status-running">running</span></div><div class="agent-output"></div>';
      document.getElementById('agents').appendChild(card);
      cards[data.agentId] = card;
    }

    if (data.type === 'agent-delta') {
      const card = cards[data.agentId];
      if (card) card.querySelector('.agent-output').textContent += data.text;
    }

    if (data.type === 'agent-done') {
      const card = cards[data.agentId];
      if (card) {
        const badge = card.querySelector('.agent-status');
        badge.textContent = data.status === 'completed' ? 'done' : 'error';
        badge.className = 'agent-status ' + (data.status === 'completed' ? 'status-done' : 'status-error');
      }
    }

    if (data.type === 'synthesis-delta') {
      document.getElementById('summary').classList.add('visible');
      document.getElementById('summary-text').textContent += data.text;
    }

    if (data.type === 'done') {
      es.close();
      document.getElementById('go').disabled = false;
    }
  };

  es.onerror = () => {
    es.close();
    document.getElementById('go').disabled = false;
  };
}

document.getElementById('topic').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') run();
});
</script>
</body>
</html>`;

const AGENT_ROLES = [
	{
		id: "technical",
		role: "Technical Expert",
		prompt: (topic: string) =>
			`You are a technical expert. Analyze this topic from a technical/engineering perspective. Be concise (3-4 paragraphs max).\n\nTopic: ${topic}`,
	},
	{
		id: "practical",
		role: "Practical Analyst",
		prompt: (topic: string) =>
			`You are a practical analyst. Analyze this topic from a real-world applications and use-cases perspective. Be concise (3-4 paragraphs max).\n\nTopic: ${topic}`,
	},
	{
		id: "critical",
		role: "Critical Reviewer",
		prompt: (topic: string) =>
			`You are a critical reviewer. Analyze this topic by identifying limitations, trade-offs, and common misconceptions. Be concise (3-4 paragraphs max).\n\nTopic: ${topic}`,
	},
];

function createAgentConfig() {
	return {
		providerId: "cline",
		modelId: "anthropic/claude-sonnet-4-6",
		apiKey: process.env.CLINE_API_KEY,
		maxIterations: 1,
	};
}

const server = createServer(async (req, res) => {
	const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

	if (url.pathname === "/") {
		res.writeHead(200, { "Content-Type": "text/html" });
		res.end(HTML);
		return;
	}

	if (url.pathname === "/run") {
		const topic = url.searchParams.get("topic");
		if (!topic) {
			res.writeHead(400);
			res.end("Missing topic");
			return;
		}

		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		});

		const send = (data: Record<string, unknown>) => {
			res.write(`data: ${JSON.stringify(data)}\n\n`);
		};

		const results = await runAgents(topic, send);

		const synthesizer = new Agent(createAgentConfig());
		synthesizer.subscribe((event) => {
			if (event.type === "assistant-text-delta") {
				send({ type: "synthesis-delta", text: event.text });
			}
		});

		const findings = results
			.map((r) => `## ${r.role}\n${r.output}`)
			.join("\n\n");

		await synthesizer.run(
			`You are a synthesizer. Three specialists analyzed a topic. Combine their findings into a clear, unified answer. Do not repeat their analyses verbatim; extract the key insights and present a cohesive response.\n\nTopic: ${topic}\n\n${findings}`,
		);

		send({ type: "done" });
		res.end();
		return;
	}

	res.writeHead(404);
	res.end("Not found");
});

interface AgentResult {
	role: string;
	output: string;
	status: string;
}

async function runAgents(
	topic: string,
	send: (data: Record<string, unknown>) => void,
): Promise<AgentResult[]> {
	const promises = AGENT_ROLES.map(async (spec) => {
		const agent = new Agent(createAgentConfig());

		send({ type: "agent-start", agentId: spec.id, role: spec.role });

		agent.subscribe((event) => {
			if (event.type === "assistant-text-delta") {
				send({ type: "agent-delta", agentId: spec.id, text: event.text });
			}
		});

		const result = await agent.run(spec.prompt(topic));

		send({
			type: "agent-done",
			agentId: spec.id,
			status: result.status,
		});

		return { role: spec.role, output: result.outputText, status: result.status };
	});

	return Promise.all(promises);
}

server.listen(PORT, () => {
	console.log(`Multi-agent server running at http://localhost:${PORT}`);
});
