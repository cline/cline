import { describe, it } from "mocha";
import should from "should";
import sinon from "sinon";
import { Readable } from "stream";
import type { FzfResultItem } from "fzf";
import * as childProcess from "child_process";
import * as vscode from "vscode";
import * as fs from "fs";
import * as fileSearch from "../../../services/search/file-search";
import * as ripgrep from "../../../services/ripgrep";

describe("File Search", function() {
  let sandbox: sinon.SinonSandbox;
  let spawnStub: sinon.SinonStub;

  beforeEach(function() {
    sandbox = sinon.createSandbox();
    spawnStub = sandbox.stub();
    sandbox.stub(fileSearch, 'getSpawnFunction').returns(() => spawnStub as unknown as fileSearch.SpawnFunction);
    sandbox.stub(vscode, 'env').value({ appRoot: "mock/app/root" });
    sandbox.stub(fs.promises, 'lstat').resolves({ isDirectory: () => false } as fs.Stats);
    sandbox.stub(ripgrep, 'getBinPath').resolves('mock/ripgrep/path');
  });

  afterEach(function() {
    sandbox.restore();
  });

  describe("executeRipgrepForFiles", function() {
    it("should correctly process and return file and folder results", async function() {
      const mockFiles = [
        "file1.txt",
        "folder1/file2.js",
        "folder1/subfolder/file3.py",
      ];

      spawnStub.returns({
        stdout: Readable.from(mockFiles.join("\n")),
        stderr: new Readable(),
        on: sinon.stub(),
      } as unknown as childProcess.ChildProcess);

      const result = await fileSearch.executeRipgrepForFiles("mock/path", "/workspace", 5000);

      should(result).be.an.Array();
      should(result).have.length(5);

      const files = result.filter((item) => item.type === "file");
      const folders = result.filter((item) => item.type === "folder");

      should(files).have.length(3);
      should(folders).have.length(2);

      should(files[0]).have.properties({
        path: "file1.txt",
        type: "file",
        label: "file1.txt"
      });

      should(folders).containDeep([
        { path: "folder1", type: "folder", label: "folder1" },
        { path: "folder1/subfolder", type: "folder", label: "subfolder" }
      ]);
    });

    it("should handle errors from ripgrep", async function() {
      const mockError = "Mock ripgrep error";
      spawnStub.returns({
        stdout: new Readable(),
        stderr: Readable.from(mockError),
        on: function(event: string, callback: Function) {
          if (event === "error") {
            callback(new Error(mockError));
          }
          return this;
        },
      } as unknown as childProcess.ChildProcess);

      await should(fileSearch.executeRipgrepForFiles("mock/path", "/workspace", 5000)).be.rejectedWith(`ripgrep process error: ${mockError}`);
    });
  });

  describe("searchWorkspaceFiles", function() {
    it("should return top N results for empty query", async function() {
      const mockItems: { path: string; type: "file" | "folder"; label?: string }[] = [
        { path: "file1.txt", type: "file", label: "file1.txt" },
        { path: "folder1", type: "folder", label: "folder1" },
        { path: "file2.js", type: "file", label: "file2.js" },
      ];

      sandbox.stub(fileSearch, "executeRipgrepForFiles").resolves(mockItems);

      const result = await fileSearch.searchWorkspaceFiles("", "/workspace", 2);

      should(result).be.an.Array();
      should(result).have.length(2);
      should(result).deepEqual(mockItems.slice(0, 2));
    });

    it("should apply fuzzy matching for non-empty query", async function() {
      const mockItems: { path: string; type: "file" | "folder"; label?: string }[] = [
        { path: "file1.txt", type: "file", label: "file1.txt" },
        { path: "folder1/important.js", type: "file", label: "important.js" },
        { path: "file2.js", type: "file", label: "file2.js" },
      ];

      sandbox.stub(fileSearch, "executeRipgrepForFiles").resolves(mockItems);
      const fzfStub = {
        find: sinon.stub().returns([{ item: mockItems[1], score: 0 }]),
      };
      const fzfModuleStub = {
        Fzf: sinon.stub().returns(fzfStub),
        byLengthAsc: sinon.stub(),
      };
      const globalAny = global as any;
      sandbox.stub(globalAny, 'import').withArgs('fzf').resolves(fzfModuleStub);

      const result = await fileSearch.searchWorkspaceFiles("imp", "/workspace", 2);

      should(result).be.an.Array();
      should(result).have.length(1);
      should(result[0]).have.properties({
        path: "folder1/important.js",
        type: "file",
        label: "important.js"
      });
    });
  });

  describe("OrderbyMatchScore", function() {
    it("should prioritize results with fewer gaps between matched characters", function() {
      const mockItemA: FzfResultItem<any> = { item: {}, positions: new Set([0, 1, 2, 5]), start: 0, end: 5, score: 0 };
      const mockItemB: FzfResultItem<any> = { item: {}, positions: new Set([0, 2, 4, 6]), start: 0, end: 6, score: 0 };

      const result = fileSearch.OrderbyMatchScore(mockItemA, mockItemB);

      should(result).be.lessThan(0);
    });
  });
});
