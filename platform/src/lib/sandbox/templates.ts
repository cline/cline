import type { TemplateId } from "@/lib/validation";

export type TemplateFiles = Record<string, string>;

const README = (name: string, language: string) =>
	`# ${name}

This workspace was provisioned by **21 Agent** and runs inside an isolated
Daytona sandbox. Start a task in the workspace to have the agent inspect, edit
and run this project.

- Template: ${language}
- Execution: remote Daytona sandbox
`;

const GITIGNORE = `node_modules/
.env
.env.local
dist/
build/
__pycache__/
*.pyc
target/
.next/
coverage/
.DS_Store
`;

const TEMPLATE_FILES: Record<TemplateId, (name: string) => TemplateFiles> = {
	blank: (name) => ({
		"README.md": README(name, "blank"),
		".gitignore": GITIGNORE,
	}),
	"node-api": (name) => ({
		"package.json": JSON.stringify(
			{
				name: "21-agent-node-api",
				private: true,
				type: "module",
				scripts: { start: "node server.mjs", test: "node --test" },
			},
			null,
			2,
		),
		"server.mjs": `import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 3000);

export function createApp() {
	return createServer((req, res) => {
		const url = new URL(req.url ?? "/", \`http://\${req.headers.host ?? "localhost"}\`);
		if (url.pathname === "/health") {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ ok: true }));
			return;
		}
		res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		res.end(\`<h1>\${url.pathname === "/" ? "${name}" : "Not found"}</h1>\`);
	});
}

if (process.env.NODE_ENV !== "test") {
	createApp().listen(port, "0.0.0.0", () => {
		console.log(\`Server listening on http://0.0.0.0:\${port}\`);
	});
}
`,
		"server.test.mjs": `import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApp } from "./server.mjs";

let server;
let base;

before(async () => {
	server = createApp();
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	base = \`http://127.0.0.1:\${address.port}\`;
});

after(() => server.close());

test("health endpoint responds", async () => {
	const response = await fetch(\`\${base}/health\`);
	assert.equal(response.status, 200);
	const body = await response.json();
	assert.equal(body.ok, true);
});
`,
		"README.md": README(name, "node"),
		".gitignore": GITIGNORE,
	}),
	"static-site": (name) => ({
		"index.html": `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>${name}</title>
		<link rel="stylesheet" href="styles.css" />
	</head>
	<body>
		<main>
			<p class="eyebrow">Built with 21 Agent</p>
			<h1>${name}</h1>
			<p>Edit this page in the workspace, then ask the agent to extend it.</p>
			<button id="hello">Say hello</button>
			<p id="output" aria-live="polite"></p>
		</main>
		<script src="app.js"></script>
	</body>
</html>
`,
		"styles.css": `:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
	margin: 0;
	min-height: 100vh;
	display: grid;
	place-items: center;
	background: radial-gradient(circle at 50% 0%, #1b2318, #08090b 60%);
	color: #f4f7ee;
	font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
}
main { max-width: 640px; padding: 64px 28px; }
.eyebrow { color: #c8ff4d; letter-spacing: .18em; text-transform: uppercase; font-size: 12px; }
h1 { font-size: clamp(40px, 8vw, 72px); letter-spacing: -.04em; margin: 12px 0; }
p { color: #a5aca2; line-height: 1.6; }
button {
	margin-top: 20px; padding: 12px 20px; border-radius: 999px;
	border: 1px solid #c8ff4d; background: #c8ff4d; color: #0a0b0d;
	font-weight: 700; cursor: pointer;
}
`,
		"app.js": `const button = document.querySelector("#hello");
const output = document.querySelector("#output");
button?.addEventListener("click", () => {
	output.textContent = "Hello from " + document.title + " — served from a real sandbox.";
});
`,
		"README.md": README(name, "static"),
		".gitignore": GITIGNORE,
	}),
	python: (name) => ({
		"main.py": `"""${name} — a 21 Agent workspace."""


def greet(name: str) -> str:
    return f"Hello, {name}!"


if __name__ == "__main__":
    print(greet("world"))
`,
		"test_main.py": `import unittest

from main import greet


class TestGreet(unittest.TestCase):
    def test_greet(self):
        self.assertEqual(greet("21 Agent"), "Hello, 21 Agent!")


if __name__ == "__main__":
    unittest.main()
`,
		"requirements.txt": "",
		"README.md": README(name, "python"),
		".gitignore": GITIGNORE,
	}),
	go: (name) => ({
		"go.mod": "module example.com/workspace\n\ngo 1.22\n",
		"main.go": `package main

import "fmt"

func Greet(name string) string {
	return fmt.Sprintf("Hello, %s!", name)
}

func main() {
	fmt.Println(Greet("world"))
}
`,
		"main_test.go": `package main

import "testing"

func TestGreet(t *testing.T) {
	if got := Greet("21 Agent"); got != "Hello, 21 Agent!" {
		t.Fatalf("unexpected greeting: %q", got)
	}
}
`,
		"README.md": README(name, "go"),
		".gitignore": GITIGNORE,
	}),
	rust: (name) => ({
		"Cargo.toml": `[package]
name = "twentyone_workspace"
version = "0.1.0"
edition = "2021"
`,
		"src/main.rs": `pub fn greet(name: &str) -> String {
    format!("Hello, {name}!")
}

fn main() {
    println!("{}", greet("world"));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn greets() {
        assert_eq!(greet("21 Agent"), "Hello, 21 Agent!");
    }
}
`,
		"README.md": README(name, "rust"),
		".gitignore": GITIGNORE,
	}),
	java: (name) => ({
		"Main.java": `public class Main {
    static String greet(String name) {
        return "Hello, " + name + "!";
    }

    public static void main(String[] args) {
        System.out.println(greet("world"));
    }
}
`,
		"README.md": README(name, "java"),
		".gitignore": GITIGNORE,
	}),
	cpp: (name) => ({
		"main.cpp": `#include <iostream>
#include <string>

std::string greet(const std::string& name) {
    return "Hello, " + name + "!";
}

int main() {
    std::cout << greet("world") << std::endl;
    return 0;
}
`,
		Makefile: `CXX ?= g++
CXXFLAGS ?= -std=c++17 -Wall -Wextra

app: main.cpp
\t$(CXX) $(CXXFLAGS) -o app main.cpp

test: app
\t./app

clean:
\trm -f app
`,
		"README.md": README(name, "c++"),
		".gitignore": GITIGNORE,
	}),
	php: (name) => ({
		"index.php": `<?php

function greet(string $name): string {
    return "Hello, " . $name . "!";
}

echo greet("world") . PHP_EOL;
`,
		"test.php": `<?php

require __DIR__ . "/index.php";

if (greet("21 Agent") !== "Hello, 21 Agent!") {
    fwrite(STDERR, "greeting test failed" . PHP_EOL);
    exit(1);
}

echo "greeting test passed" . PHP_EOL;
`,
		"README.md": README(name, "php"),
		".gitignore": GITIGNORE,
	}),
	ruby: (name) => ({
		"main.rb": `def greet(name)
  "Hello, #{name}!"
end

puts greet("world") if __FILE__ == $PROGRAM_NAME
`,
		"test_main.rb": `require "minitest/autorun"
require_relative "main"

class TestGreet < Minitest::Test
  def test_greet
    assert_equal "Hello, 21 Agent!", greet("21 Agent")
  end
end
`,
		"README.md": README(name, "ruby"),
		".gitignore": GITIGNORE,
	}),
};

export function templateFiles(template: string, projectName: string): TemplateFiles {
	const factory = TEMPLATE_FILES[template as TemplateId] ?? TEMPLATE_FILES.blank;
	return factory(projectName);
}

export const TEMPLATE_IDS = Object.keys(TEMPLATE_FILES) as TemplateId[];
