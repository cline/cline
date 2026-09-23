import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIgnoreMatcher } from "./ignore-matcher";

describe("ignore-matcher", () => {
 let cwd: string;

 beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), "ignore-matcher-test-"));
 });

 afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
 });

 async function write(relPath: string, content: string) {
  const full = path.join(cwd, relPath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content);
 }

 it("ignores a path matched by root .gitignore", async () => {
  await write(".gitignore", "build/\n");
  await write("build/generated.js", "SOME_IDENTIFIER");
  const matcher = await buildIgnoreMatcher(cwd, [".gitignore", "build/generated.js"]);
  expect(matcher.isIgnored("build/generated.js")).toBe(true);
 });

 it("ignores a path matched only by .clineignore (not .gitignore)", async () => {
  await write(".clineignore", "secrets/\n");
  await write("secrets/keys.json", "{}");
  const matcher = await buildIgnoreMatcher(cwd, [".clineignore", "secrets/keys.json"]);
  expect(matcher.isIgnored("secrets/keys.json")).toBe(true);
 });

 it("ignores a path matched only by .agentignore", async () => {
  await write(".agentignore", "scratch/\n");
  await write("scratch/notes.md", "x");
  const matcher = await buildIgnoreMatcher(cwd, [".agentignore", "scratch/notes.md"]);
  expect(matcher.isIgnored("scratch/notes.md")).toBe(true);
 });

 it("does not ignore a path no ignore file mentions", async () => {
  await write(".gitignore", "build/\n");
  await write("src/index.ts", "export {}");
  const matcher = await buildIgnoreMatcher(cwd, [".gitignore", "src/index.ts"]);
  expect(matcher.isIgnored("src/index.ts")).toBe(false);
 });

 it("gives .agentignore the final word over .gitignore in the same directory", async () => {
  await write(".gitignore", "logs/\n");
  await write(".agentignore", "!logs/\n!logs/**\n");
  await write("logs/debug.log", "x");
  const matcher = await buildIgnoreMatcher(cwd, [".gitignore", ".agentignore", "logs/debug.log"]);
  expect(matcher.isIgnored("logs/debug.log")).toBe(false);
 });

 it("gives .agentignore precedence when it re-ignores what .clineignore un-ignored", async () => {
  await write(".clineignore", "!dist/\n!dist/**\n");
  await write(".agentignore", "dist/\n");
  await write("dist/bundle.js", "x");
  const matcher = await buildIgnoreMatcher(cwd, [".clineignore", ".agentignore", "dist/bundle.js"]);
  expect(matcher.isIgnored("dist/bundle.js")).toBe(true);
 });

 it("does NOT let a nested ignore file re-include a path whose parent directory is already excluded", async () => {
  await write(".gitignore", "vendor/\n");
  await write("vendor/.gitignore", "!keep-this/\n!keep-this/**\n");
  await write("vendor/keep-this/readme.md", "x");
  const matcher = await buildIgnoreMatcher(cwd, [".gitignore", "vendor/.gitignore", "vendor/keep-this/readme.md"]);
  expect(matcher.isIgnored("vendor/keep-this/readme.md")).toBe(true);
 });

 it("lets a nested ignore file add its own additional excludes beyond what a shallower file covers", async () => {
  await write(".gitignore", "build/\n");
  await write("src/.clineignore", "generated/\n");
  await write("src/generated/codegen.ts", "x");
  await write("src/handwritten.ts", "x");
  const matcher = await buildIgnoreMatcher(cwd, [".gitignore", "src/.clineignore", "src/generated/codegen.ts", "src/handwritten.ts"]);
  expect(matcher.isIgnored("src/generated/codegen.ts")).toBe(true);
  expect(matcher.isIgnored("src/handwritten.ts")).toBe(false);
 });

 it("does not ignore anything when no ignore files exist", async () => {
  await write("src/index.ts", "export {}");
  const matcher = await buildIgnoreMatcher(cwd, ["src/index.ts"]);
  expect(matcher.isIgnored("src/index.ts")).toBe(false);
 });
});
