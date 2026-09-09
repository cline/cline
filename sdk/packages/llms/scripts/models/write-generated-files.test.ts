import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeGeneratedFiles } from "./write-generated-files";

describe("writeGeneratedFiles", () => {
	let root: string;
	beforeEach(() => {
		root = fs.mkdtempSync(join(tmpdir(), "catalog-test-"));
	});
	afterEach(() => {
		vi.restoreAllMocks();
		fs.rmSync(root, { recursive: true, force: true });
	});
	it("updates all files and removes staging directories", () => {
		const path = join(root, "existing.ts");
		fs.writeFileSync(path, "old");
		writeGeneratedFiles(
			new Map([
				[path, "updated"],
				[join(root, "new.ts"), "new"],
			]),
		);
		expect(fs.readFileSync(path, "utf8")).toBe("updated");
		expect(fs.readdirSync(root).sort()).toEqual(["existing.ts", "new.ts"]);
	});
	it("leaves destinations untouched if staging fails", () => {
		const path = join(root, "existing.ts");
		fs.writeFileSync(path, "old");
		const write = fs.writeFileSync;
		vi.spyOn(fs, "writeFileSync").mockImplementation((...args) => {
			if (args[1] === "fail") throw new Error("staging failed");
			return write(...args);
		});
		expect(() =>
			writeGeneratedFiles(
				new Map([
					[path, "updated"],
					[join(root, "new.ts"), "fail"],
				]),
			),
		).toThrow("staging failed");
		expect(fs.readFileSync(path, "utf8")).toBe("old");
		expect(fs.readdirSync(root)).toEqual(["existing.ts"]);
	});
	it("rolls back replaced files and removes newly created outputs after a later rename fails", () => {
		const path = join(root, "existing.ts");
		const last = join(root, "last.ts");
		fs.writeFileSync(path, "old");
		fs.writeFileSync(last, "last old");
		const rename = fs.renameSync;
		vi.spyOn(fs, "renameSync").mockImplementation((source, destination) => {
			if (destination === last) throw new Error("replacement failed");
			return rename(source, destination);
		});
		expect(() =>
			writeGeneratedFiles(
				new Map([
					[path, "updated"],
					[join(root, "new.ts"), "new"],
					[last, "last new"],
				]),
			),
		).toThrow("replacement failed");
		expect(fs.readFileSync(path, "utf8")).toBe("old");
		expect(fs.readFileSync(last, "utf8")).toBe("last old");
		expect(fs.readdirSync(root).sort()).toEqual(["existing.ts", "last.ts"]);
	});
	it("retains recovery files if rollback also fails", () => {
		const path = join(root, "existing.ts");
		const last = join(root, "last.ts");
		fs.writeFileSync(path, "old");
		fs.writeFileSync(last, "last old");
		const rename = fs.renameSync;
		vi.spyOn(fs, "renameSync").mockImplementation((source, destination) => {
			if (destination === last || String(source).endsWith("previous"))
				throw new Error("rename failed");
			return rename(source, destination);
		});
		expect(() =>
			writeGeneratedFiles(
				new Map([
					[path, "updated"],
					[last, "last new"],
				]),
			),
		).toThrow("recovery files retained");
		const backups = fs
			.readdirSync(root)
			.filter((name) => name.startsWith(".catalog-stage-"))
			.map((name) => fs.readFileSync(join(root, name, "previous"), "utf8"));
		expect(backups.sort()).toEqual(["last old", "old"]);
	});
	it("does not replace unchanged outputs", () => {
		const path = join(root, "existing.ts");
		fs.writeFileSync(path, "same");
		const rename = vi.spyOn(fs, "renameSync");
		writeGeneratedFiles(new Map([[path, "same"]]));
		expect(rename).not.toHaveBeenCalled();
	});
});
