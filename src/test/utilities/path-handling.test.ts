import { describe, it } from "mocha"
import * as fs from "fs"
import * as path from "path"
// Using require for chai to fix ESM import issue
const chai = require("chai")
const { expect } = chai
import * as vscode from "vscode"
import { getShell } from "../../utils/shell"
import "../../utils/global-path" // Initialize safeDirname
