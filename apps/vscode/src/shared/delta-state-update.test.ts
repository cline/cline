import { describe, expect, it } from "bun:test"
import { DeltaEncoder, DeltaUpdater } from "./delta-state-update"

describe("delta updater", () => {
    it("throws if given non-sequential updates", () => {
        const updater = new DeltaUpdater<string>({type: 'complete', value: 'hello', version: 7});
        expect(() => updater.apply({type: 'delta', patch: [], version: 9})).toThrow();
        expect (() => updater.apply({type: 'delta', patch: [], version: 6})).toThrow();
    })

    it("should produce an updated value from a delta", async () => {
        let value: Record<string,any> = {foo: 'bar'};
        const generator = new DeltaEncoder(() => value);
        const updater = new DeltaUpdater(await generator.initialUpdate());
        value['foo'] = 'baz';
        value[7] = {x: 42};
        const updated = updater.apply(await generator.getUpdate());
        expect(updated).toEqual(value);
    })

    it("should apply consecutive updates", async () => {
        let value: Record<string,any> = {foo: 'bar'};
        const generator = new DeltaEncoder(() => value);
        const updater = new DeltaUpdater(await generator.initialUpdate());

        value['foo'] = 'baz';
        let updated = updater.apply(await generator.getUpdate());
        expect(updated).toEqual(value);

        value[7] = {x: 42};
        updated = updater.apply(await generator.getUpdate());
        expect(updated).toEqual(value);
    })

    it("should apply whole values", async () => {
        let value: Record<string,any> = {foo: 'bar'};
        const generator = new DeltaEncoder(() => value);
        const updater = new DeltaUpdater(await generator.initialUpdate());

        value['foo'] = 'baz';
        let updated = updater.apply(await generator.getUpdate());
        expect(updated).toEqual(value);

        // Apply a complete update.
        updated = updater.apply({type: 'complete', value: ['honey'], version: 3});
        expect(updated).toEqual(['honey']);

        // Apply a delta update to the previous complete update.
        updated = updater.apply({type: 'delta', version: 4, patch: [{path: '/1', op: 'add', value: 'badger'}]})
        expect(updated).toEqual(['honey', 'badger']);
    })
})
