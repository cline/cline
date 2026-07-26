# The collaboration harness

Agents · Orchestration · Product · Draft for harrisonhalperin.com · ~8 min read

Agent orchestrationAI governanceDeveloper toolsSchemasLocal-first

## Thesis

An agent harness wraps a model so it can act. A meta-harness sits above several harnesses so you can compose and govern them. Neither name is enough when the product is a live call between a human and recruitable agents. That missing layer is a collaboration harness: pure policies and projections for rooms, addressing, stage, and interruption, while a host still owns commits and the agent runtime still owns turns.

## What the industry already named

"Harness" is old engineering language. A test harness drives software under controlled conditions. In agent work the word came back with a sharper meaning.

Databricks puts it plainly: an [AI agent harness](https://www.databricks.com/blog/ai-harness) is the infrastructure around an LLM that supplies tools, memory, execution environments, and guardrails so the model can finish real tasks instead of only answering prompts. LangChain’s [anatomy of an agent harness](https://www.langchain.com/blog/the-anatomy-of-an-agent-harness) compresses the same idea to Agent = Model + Harness. Recent research treats harness scaling as a first-class problem alongside model scaling ([From Model Scaling to System Scaling](https://arxiv.org/html/2605.26112)).

One level up, Databricks’ Omnigent calls itself a [meta-harness](https://www.databricks.com/blog/introducing-omnigent-meta-harness-combine-control-and-share-your-agents): a layer above Claude Code, Codex, Cursor, and friends for composition, policy, and shared sessions. That is the right move when your pain is "I run five agent products and none of them share a control plane."

What I do not see in that vocabulary is a standard term for the product object I keep rebuilding: a call-shaped collaboration surface that is neither the agent loop nor a generic multi-agent orchestrator.

Search for "collaboration harness" and you mostly get agent-harness essays that happen to mention collaboration as a feature of Omnigent or of multi-agent filesystem ledgers. The compound is not a defined category. So I’m naming it on purpose.

## The gap those terms leave open

An agent harness optimizes one brain with tools. It asks: can this model edit the repo, call APIs, and recover from mistakes?

A meta-harness optimizes interchange and governance across brains. It asks: can I swap Claude Code for Codex without rewriting policy, and can two humans look at the same session?

A collaboration product asks different questions:

- Who is in the room, and why are they seated?
- Who is this message for: one agent, a pack, or everyone?
- What is on the shared stage right now, as typed work events rather than a video of pixels?
- What happens when a human raises a hand mid-tool?
- Who is allowed to remember what after the call ends?

Those questions are product domain, not model plumbing. If you bury them inside the agent harness, you fork the runtime. If you push them into a meta-harness that only wraps CLI agents, you inherit someone else’s session model. If you put them only in the UI, every client invents a second source of truth.

## Definition

A collaboration harness is the pure layer that owns the collaboration domain and proposes the next legal collaboration move, while a host commits shared state and an agent runtime executes turns.

Three verbs keep the boundary honest:

1. The harness proposes.
2. The host commits.
3. Apps project.

Propose means: resolve address sets, classify interrupts, expand seating packs, fold events into a room snapshot, project a stage, score a recruit query, compile an agent home into a host-shaped view. Commit means: one writer mutates room state and durable config, then broadcasts. Project means: webviews and terminals render the same events without becoming writers.

If your "collaboration layer" opens sockets, writes the roster, or stores prompts, it is not a harness anymore. It is a second runtime wearing a nicer name.

## What it is not

It is not a CRDT meeting app. One writer is enough when the product is a local pair call with a hub.

It is not a second agent registry. Appearance overlays sit in the collaboration layer. Prompts, tools, and models stay in an authoring home that compiles into the host. Dual registries are how products rot.

It is not Omnigent by rename. Meta-harness problems are real. Collaboration-harness problems show up even when you only ever bind one host. Cline alone still needs rooms, addressing, stage, gates, and privacy lanes.

It is not a process wizard. Senior guidance on requirements and decisions can live as on-demand workflows inside the call. Instant join stays sacred. "Just build it" has to remain a valid escape.

## A concrete shape

The shape I want looks like this:

```text
Apps (Drive tab, CLI)     project events, ephemeral chrome only
Host (hub / drive-host)   single writer of room + durable config
Collaboration harness     pure policies, reducers, host port, compile/recruit
Contracts (shared schemas) versioned events, roster, facets, homes
Agent runtime             turns, tools, work facts upward
```

The host capability descriptor declares what the host can actually do, including who the writer is. A conformance kit should fail closed when a host claims a capability and no-ops. That is the Omnigent lesson applied inward: matrices without benches become marketing.

Privacy belongs in the schemas. Events that cannot carry raw audio or full transcripts are cheaper to trust than a settings toggle that someone forgets. Learning that writes agent knowledge should be propose → accept, never a silent diary of the call.

## Why the name is worth fighting for

Names steer architecture reviews. If everyone says "agent harness," reviewers will keep asking for better tool loops and miss that the roster is the product. If everyone says "orchestration," you get another DAG of agents and no call UX. If everyone says "meta-harness," you reach for multi-vendor composition before you have a single honest room.

Collaboration harness names the missing middle: portable collaboration semantics over a host-owned commit path.

Soft metric only: when the term is working, a design argument ends with "that belongs in propose, commit, or project," not with another package that does all three.

## What I’d reuse elsewhere

Anywhere humans and agents share live work:

- Keep collaboration policy pure and importable by both server and UI.
- Keep one writer for shared objects.
- Prefer typed work events over pixel capture until you truly need media.
- Separate seating presets from runtime execution groups. Different words, different types.
- Teach requirements and decisions inside the collaboration surface without making process a lobby.

I’m building this first against Cline as Drive: a Discord-shaped call inside Slack-like chrome, with recruitable agent portfolios and on-demand SDLC guidance. The host is Cline’s hub. The harness is the pure Drive package. The apps only project.

If the category sticks, the next interesting question is boring in the best way: which hosts can implement the same port without lying about their writer.

## Related reading

[What is an AI Agent Harness? (Databricks)](https://www.databricks.com/blog/ai-harness) · [The Anatomy of an Agent Harness (LangChain)](https://www.langchain.com/blog/the-anatomy-of-an-agent-harness) · [Omnigent: a meta-harness (Databricks)](https://www.databricks.com/blog/introducing-omnigent-meta-harness-combine-control-and-share-your-agents) · [From Model Scaling to System Scaling](https://arxiv.org/html/2605.26112)

## Notes for publish

- Suggested slug: `the-collaboration-harness`
- Suggested tags: Agent orchestration, AI governance, Developer tools, Schemas, Local-first
- Pair with site work nodes for Drive / MOS / Agent CI-CD once those projects are public enough to cite as evidence
