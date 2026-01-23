import os from "node:os"
import path from "node:path"

const data = process.env.CLINE_DATA_DIR ?? path.join(os.homedir(), ".cline", "data")

const log = process.env.CLINE_LOG_DIR ?? path.join(data, "logs")

export const CLINE_CLI_DIR = {
	data,
	log,
}
