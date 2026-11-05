// Given JSON objects, encodes a delta update between the two.

import { applyPatch, compare } from 'fast-json-patch'

type CanDelta = Parameters<typeof compare>[0];

type DeltaCache<T> = {
    value: T,
    version: number,
}

export type DeltaUpdate<T extends CanDelta> = {
    type: 'complete',
    value: T,
    version: number,
} | {
    type: 'delta',
    patch: ReturnType<typeof compare>,
    version: number,
}

export class DeltaGenerator<T extends CanDelta> {
    private cached: DeltaCache<T> | undefined

    constructor(private readonly getValue: () => T | Promise<T>) {}

    private async getAndCacheValue(): Promise<DeltaCache<T>> {
        const lastVersion = this.cached?.version || 0;
        this.cached = {
            value: structuredClone(await this.getValue()),
            version: lastVersion + 1,
        };
        return this.cached;
    }

    private async ensureCached(): Promise<DeltaCache<T>> {
        return this.cached || await this.getAndCacheValue();
    }

    // Gets the last provided value, as a "complete" value. Fetches the value if it has not been fetched yet, but
    // will not fetch updates.
    public async initialUpdate(): Promise<{ type: 'complete', value: T, version: number }> {
        const cached = await this.ensureCached();
        return {
            type: 'complete',
            value: structuredClone(cached.value),
            version: cached.version,
        }
    }

    // Fetches the value, and generates delta updates from the previous state.
    public async getUpdate(): Promise<DeltaUpdate<T>> {
        if (!this.cached) {
            return this.initialUpdate();
        }
        const last = this.cached;
        const next = await this.getAndCacheValue();
        // TODO: Strictly serialize this class.
        if (last.version + 1 !== next.version) {
            throw new Error('DeltaGenerator has missed a sequential version (interleaved state generation)');
        }
        const patch = compare(last.value, next.value);
        return {
            type: 'delta',
            patch,
            version: next.version,
        }
    }
}

export class DeltaUpdater<T extends CanDelta> {
    private value: T;
    private version: number;

    constructor({value, version}: { type: 'complete', value: T, version: number }) {
        this.value = structuredClone(value);
        this.version = version;
    }

    public apply(delta: DeltaUpdate<T>): T {
        switch (delta.type) {
            case 'complete': {
                this.value = structuredClone(delta.value);
                this.version = delta.version;
                break;
            }
            case 'delta': {
                if (delta.version !== this.version + 1) {
                    throw new Error(`DeltaUpdater has missed a sequential version (last version was ${this.version}, received delta to version ${delta.version})`);
                }
                // TODO: what is jsonpatch's validation and do we want it?
                const validate = false;
                const mutateDocument = true;
                applyPatch(this.value, delta.patch, validate, mutateDocument);
                this.version = delta.version;
                break;
            }
        }
        return structuredClone(this.value);
    }
}