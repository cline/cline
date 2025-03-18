import { describe, it, beforeEach, afterEach } from "mocha"
// Using require for chai to fix ESM import issue
const chai = require("chai")
const { expect } = chai
import { getShell } from "../../utils/shell"
import * as vscode from "vscode"
import { userInfo } from "os"
