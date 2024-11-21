#!/usr/bin/env -S deno run --allow-read=. --allow-write=. --allow-run --allow-net --allow-env

import { parse } from "./deps.ts";
import { blue, red, gray, yellow, bold } from "./deps.ts";
import { buildApiHandler } from "./api/mod.ts";
import { StandaloneAgent } from "./core/StandaloneAgent.ts";
import { SYSTEM_PROMPT } from "./core/prompts.ts";
import type { ApiHandler, AgentConfig } from "./types.d.ts";

// Parse command line arguments
const args = parse(Deno.args, {
  string: ["model", "key"],
  boolean: ["help"],
  alias: {
    m: "model",
    k: "key",
    h: "help"
  },
  default: {
    model: "anthropic/claude-3.5-sonnet"
  },
});

if (args.help || Deno.args.length === 0) {
  console.log(blue("\nCline - AI Coding Assistant\n"));
  
  console.log("Usage:");
  console.log("  cline <task> [options]\n");

  console.log("Required Permissions:");
  console.log("  --allow-read=.     Read files in working directory");
  console.log("  --allow-write=.    Write files in working directory");
  console.log("  --allow-run        Execute commands (with interactive prompts)\n");
  console.log("  --allow-net        Make API calls");
  console.log("  --allow-env        Access environment variables\n");

  console.log("Pre-approved Commands:");
  console.log("  npm   - Package management (install, run, test, build)");
  console.log("  git   - Version control (status, add, commit, push, pull, clone)");
  console.log("  deno  - Deno runtime (run, test, fmt, lint, check)");
  console.log("  ls    - List directory contents");
  console.log("  cat   - Show file contents");
  console.log("  echo  - Print text");
  console.log("  find  - Search for files");
  console.log("\nOther commands will prompt for confirmation before execution.\n");

  console.log("Options:");
  console.log("  -m, --model <model>  LLM model to use (default: \"anthropic/claude-3.5-sonnet\")");
  console.log("  -k, --key <key>      OpenRouter API key (or set OPENROUTER_API_KEY env var)");
  console.log("  -h, --help           Display help for command\n");
  
  console.log("Examples:");
  console.log(gray("  # Run pre-approved command"));
  console.log("  cline \"Run npm install\"\n");
  
  console.log(gray("  # Run command that requires confirmation"));
  console.log("  cline \"Run yarn install\"\n");
  
  Deno.exit(0);
}

// Verify required permissions
const requiredPermissions = [
  { name: "read", path: "." },
  { name: "write", path: "." },
  { name: "run" },
  { name: "net" },
  { name: "env" }
] as const;

for (const permission of requiredPermissions) {
  const status = await Deno.permissions.query(permission);
  if (status.state !== "granted") {
    console.error(red(`Error: Missing required permission`));
    console.error(yellow(`Hint: Run with the following permissions:`));
    console.error(yellow(`  deno run ${requiredPermissions.map(p => 
      "path" in p ? `--allow-${p.name}=${p.path}` : `--allow-${p.name}`
    ).join(" ")} cli/mod.ts ...\n`));
    Deno.exit(1);
  }
}

const task = args._[0] as string;
const apiKey = args.key || Deno.env.get("OPENROUTER_API_KEY");

if (!apiKey) {
  console.error(red("Error: OpenRouter API key is required. Set it with --key or OPENROUTER_API_KEY env var"));
  console.error(yellow("Get your API key from: https://openrouter.ai/keys"));
  Deno.exit(1);
}

try {
  const workingDir = Deno.cwd();

  // Initialize API handler
  const apiHandler = buildApiHandler({
    model: args.model,
    apiKey
  });

  // Create agent instance
  const agent = new StandaloneAgent({
    api: apiHandler,
    systemPrompt: await SYSTEM_PROMPT(workingDir),
    workingDir
  });

  // Run the task
  console.log(blue(`\nStarting task: ${bold(task)}`));
  console.log(gray(`Working directory: ${workingDir}`));
  console.log(gray(`Model: ${args.model}`));
  console.log(gray("---\n"));

  await agent.runTask(task);

} catch (error) {
  if (error instanceof Error) {
    console.error(red(`\nError: ${error.message}`));
  } else {
    console.error(red("\nAn unknown error occurred"));
  }
  Deno.exit(1);
}
