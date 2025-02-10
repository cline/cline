// __tests__/MockTransport.ts
import { CompactTransport } from "../CompactTransport"
import type { CompactLogEntry, CompactTransportConfig } from "../types"

const TEST_CONFIG: CompactTransportConfig = {
	level: "fatal",
	fileOutput: {
		enabled: false,
		path: "",
	},
}

export class MockTransport extends CompactTransport {
	public entries: CompactLogEntry[] = []
	public closed = false

	constructor() {
		super(TEST_CONFIG)
	}

	override async write(entry: CompactLogEntry): Promise<void> {
		this.entries.push(entry)
	}

	override async close(): Promise<void> {
		this.closed = true
		await super.close()
	}

	clear(): void {
		this.entries = []
		this.closed = false
	}
}
