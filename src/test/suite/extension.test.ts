import { readFile } from "fs/promises"
// Using require for mocha to fix ESM import issue
const mocha = require("mocha")
const { describe, it, after } = mocha
import path from "path"
import "should"
import * as vscode from "vscode"
import "../../utils/global-path" // Initialize safeDirname

// ... existing code ...
