import { describe, expect, it } from "bun:test"
import { DeltaGenerator, DeltaUpdater } from "./delta-state-update"

describe("delta updater", () => {
    it("throws if given non-sequential updates", () => {
        const updater = new DeltaUpdater<string>({type: 'complete', value: 'hello', version: 7});
        expect(() => updater.apply({type: 'delta', patch: undefined, version: 9})).toThrow();
        expect (() => updater.apply({type: 'delta', patch: undefined, version: 6})).toThrow();
    })

    it("should produce an updated value from a delta", async () => {
        let value: object = {foo: 'bar'};
        const generator = new DeltaGenerator(() => value);
        const updater = new DeltaUpdater(await generator.initialUpdate());
        value['foo'] = 'baz';
        value[7] = {x: 42};
        const updated = updater.apply(await generator.getUpdate());
        expect(updated).toEqual(value);
    })
})
