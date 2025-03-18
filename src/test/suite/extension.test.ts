import { readFile } from "fs/promises"
// Using require for mocha to fix ESM import issue
const mocha = require("mocha")
const { describe, it, after } = mocha
import path from "path"
import "should"
import * as vscode from "vscode"
// Import the specific path utilities we need
import { arePathsEqual, getReadablePath } from "../../utils/path"

// ... existing code ...
