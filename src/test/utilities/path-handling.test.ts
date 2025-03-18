import { describe, it } from "mocha"
import * as fs from "fs"
import * as path from "path"
// Using require for chai to fix ESM import issue
const chai = require("chai")
const { expect } = chai
import * as vscode from "vscode"
import { getShell } from "../../utils/shell"
// Import the path utils instead of the missing global-path module
import "../../utils/path"
