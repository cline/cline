// Run with Node >=22.13: node apps/vscode/scripts/test-closed-output-logging.cjs
// Execute the actual TypeScript implementations with lightweight host doubles.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { stripTypeScriptTypes } = require('node:module')
const root = path.resolve(__dirname, '..')
const context = vm.createContext({ process, Promise, Error, Set, console })
function source(name) { return fs.readFileSync(path.join(root, 'src', name), 'utf8') }
function load(name) {
    const code = stripTypeScriptTypes(source(name), { mode: 'transform' })
        .replace(/^import .*$/gm, '').replace(/^export /gm, '')
    vm.runInContext(code, context, { filename: name })
}
load('shared/services/Logger.ts')
const Logger = vm.runInContext('Logger', context)
let calls = 0, failure
context.vscode = { window: { createOutputChannel: () => ({ appendLine() {
    calls++
    if (failure) throw failure
} }) } }
context.Empty = { create: value => value }
load('hosts/vscode/hostbridge/env/debugLog.ts')
context.uuidv4 = () => 'test-request'
context.GrpcHandler = class { async handleRequest(service, method, request) {
    if (method === 'debugLog') return context.debugLog(request)
    throw new Error('ordinary request failure')
} }
load('hosts/vscode/hostbridge/client/host-grpc-client-base.ts')
const bridge = context.createGrpcClient({ fullName: 'EnvService', methods: {
    debugLog: { name: 'DebugLog', responseStream: false },
    ordinary: { name: 'Ordinary', responseStream: false },
} })
const unhandled = []
process.on('unhandledRejection', error => unhandled.push(error))
const settle = () => new Promise(resolve => setImmediate(resolve))
;(async () => {
    Logger.subscribe(value => bridge.debugLog({ value }))
    Logger.log('healthy output')
    await settle()
    assert.equal(calls, 1)
    failure = new Error('Channel has been closed')
    for (let i = 0; i < 100; i++) Logger.log('shutdown output')
    await settle()
    assert.equal(calls, 101)
    assert.deepEqual(unhandled, [])
    failure = new Error('unexpected output error')
    await assert.rejects(bridge.debugLog({ value: 'direct request' }), /unexpected output error/)
    assert.equal(calls, 102)
    Logger.log('async sink failure')
    await settle()
    assert.equal(calls, 103)
    assert.deepEqual(unhandled, [])
    // Plain thrown values and other errors must not be silently treated as closure.
    failure = 'Channel has been closed'
    await assert.rejects(bridge.debugLog({ value: 'plain value' }), error => error === failure)
    failure = new Error('unexpected output error')
    const before = calls
    await assert.rejects(bridge.ordinary({}), /ordinary request failure/)
    await settle()
    assert.equal(calls, before + 1)
    assert.deepEqual(unhandled, [])
    // A synchronous failure must not prevent delivery to another subscriber.
    Logger.clearSubscribers()
    let delivered = 0
    Logger.subscribe(() => { throw new Error('sync failure') })
    Logger.subscribe(() => { delivered++ })
    Logger.log('fan out')
    assert.equal(delivered, 1)
    Logger.clearSubscribers()
    Logger.subscribe(value => bridge.debugLog({ value }))
    // Run the real deactivation entry with host cleanup doubles.
    const entry = source('extension.ts').match(/export async function deactivate\(\) \{[\s\S]*?\n\}/)[0]
    let disposed = false
    context.tearDown = async () => {
        const before = calls
        Logger.log('teardown after output disposal')
        await settle()
        assert.equal(calls, before)
        throw new Error('teardown failure')
    }
    context.disposeVscodeCommentReviewController = () => { disposed = true }
    vm.runInContext(entry.replace('export ', ''), context)
    await assert.rejects(context.deactivate(), /teardown failure/)
    assert.equal(disposed, true)
    await settle()
    assert.deepEqual(unhandled, [])
    console.log('PASS: bounded closed-channel logging, error propagation, async/sync sink isolation, ordinary diagnostics, and teardown ordering')
})().catch(error => { console.error(error); process.exitCode = 1 })
