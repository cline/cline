#!/usr/bin/env python3
"""Insert the NeuronPool builtin after Together in Cline OPENAI_COMPATIBLE_SPEC_OVERRIDES."""

from pathlib import Path

PATH = Path("sdk/packages/llms/src/providers/builtins.ts")
text = PATH.read_text()
if 'id: "neuronpool"' in text:
    print("neuronpool already present")
    raise SystemExit(0)

anchor = (
    '\t\tdefaults: { baseUrl: "https://api.together.xyz/v1" },\n'
    "\t},\n"
    "\t{\n"
    '\t\tid: "groq",\n'
)
insert = (
    '\t\tdefaults: { baseUrl: "https://api.together.xyz/v1" },\n'
    "\t},\n"
    "\t{\n"
    '\t\tid: "neuronpool",\n'
    '\t\tname: "NeuronPool",\n'
    '\t\tdescription: "OpenAI-compatible social compute — pool machines plus public buyers",\n'
    '\t\tfamily: "openai-compatible",\n'
    '\t\tcapabilities: ["tools"],\n'
    '\t\tdefaultModelId: "gpt-oss-20b",\n'
    '\t\tapiKeyEnv: ["NEURONPOOL_API_KEY"],\n'
    '\t\tdocsUrl: "https://neuronpool.damnknee.workers.dev/dashboard",\n'
    '\t\tdefaults: { baseUrl: "https://neuronpool.damnknee.workers.dev/v1" },\n'
    "\t},\n"
    "\t{\n"
    '\t\tid: "groq",\n'
)
if anchor not in text:
    raise SystemExit("together/groq anchor not found in builtins.ts")
PATH.write_text(text.replace(anchor, insert, 1))
print("inserted neuronpool builtin")
