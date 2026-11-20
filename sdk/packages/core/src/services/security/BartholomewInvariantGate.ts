import * as crypto from "node:crypto";

export interface InvariantCheckResult {
  allowed: boolean;
  score: number;
  violationReason?: string;
  merkleReceipt?: string;
  latencyMicroseconds: number;
}

export interface MerkleReceipt {
  rootHash: string;
  timestamp: string;
  actionId: string;
  status: "VERIFIED_UNTAMPERED" | "VIOLATION_BLOCKED";
}

export interface PrepaidWalletStatus {
  hasCardOnFile: boolean;
  prepaidBalanceUsd: number;
  remainingScans: number;
  isCapped: boolean;
}

const FORBIDDEN_PATTERNS = [
  /(\bcurl\b|\bwget\b).*\|\s*(bash|sh|zsh)/i,
  /rm\s+-rf\s+([\/\\]|~|\$HOME)/i,
  /\/dev\/(tcp|udp)\//i,
  /mkfifo\s+/i,
  /(eval|exec)\(.*(atob|base64)/i,
  /\b(id_rsa|id_ed25519|\.aws\/credentials|\.env)\b/i,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
];

export class BartholomewInvariantGate {
  private static instance: BartholomewInvariantGate;
  private prepaidBalanceUsd: number = 10.0;
  private remainingScans: number = 100000;
  private readonly hasCardOnFile: boolean = false;

  private constructor() {}

  public static getInstance(): BartholomewInvariantGate {
    if (!BartholomewInvariantGate.instance) {
      BartholomewInvariantGate.instance = new BartholomewInvariantGate();
    }
    return BartholomewInvariantGate.instance;
  }

  public validateCommand(command: string): InvariantCheckResult {
    const startTime = process.hrtime.bigint();

    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(command)) {
        const endTime = process.hrtime.bigint();
        const latencyMicroseconds = Number(endTime - startTime) / 1000;
        return {
          allowed: false,
          score: 0,
          violationReason: `Deterministic invariant gate blocked dangerous pattern: ${pattern.source}`,
          latencyMicroseconds,
        };
      }
    }

    const endTime = process.hrtime.bigint();
    const latencyMicroseconds = Number(endTime - startTime) / 1000;
    const actionId = `cmd_${Date.now()}`;
    const receipt = this.generateMerkleReceipt(actionId, { command });

    return {
      allowed: true,
      score: 100,
      merkleReceipt: receipt.rootHash,
      latencyMicroseconds,
    };
  }

  public validateToolCall(
    toolName: string,
    params: Record<string, unknown>
  ): InvariantCheckResult {
    const startTime = process.hrtime.bigint();

    if (toolName === "execute_command" && typeof params.command === "string") {
      return this.validateCommand(params.command);
    }

    const payloadStr = JSON.stringify(params || {});
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(payloadStr)) {
        const endTime = process.hrtime.bigint();
        return {
          allowed: false,
          score: 0,
          violationReason: `Deterministic invariant gate blocked tool payload matching: ${pattern.source}`,
          latencyMicroseconds: Number(endTime - startTime) / 1000,
        };
      }
    }

    const endTime = process.hrtime.bigint();
    const actionId = `tool_${toolName}_${Date.now()}`;
    const receipt = this.generateMerkleReceipt(actionId, params);

    return {
      allowed: true,
      score: 100,
      merkleReceipt: receipt.rootHash,
      latencyMicroseconds: Number(endTime - startTime) / 1000,
    };
  }

  public generateMerkleReceipt(
    actionId: string,
    payload: unknown
  ): MerkleReceipt {
    const serialized = JSON.stringify({ actionId, payload });
    const hash = crypto.createHash("sha256").update(serialized).digest("hex");
    return {
      rootHash: `0x${hash}`,
      timestamp: new Date().toISOString(),
      actionId,
      status: "VERIFIED_UNTAMPERED",
    };
  }

  public getWalletStatus(): PrepaidWalletStatus {
    return {
      hasCardOnFile: this.hasCardOnFile,
      prepaidBalanceUsd: this.prepaidBalanceUsd,
      remainingScans: this.remainingScans,
      isCapped: true,
    };
  }
}
