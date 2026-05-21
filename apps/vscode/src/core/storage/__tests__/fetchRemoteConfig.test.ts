import * as diskStorage from "@core/storage/disk"
import * as remoteConfigFetch from "@core/storage/remote-config/fetch"
import * as remoteConfigUtils from "@core/storage/remote-config/utils"
import * as assert from "assert"
import { afterEach, beforeEach, describe, it } from "mocha"
import sinon from "sinon"
import { ClineAccountService } from "@/services/account/ClineAccountService"
import { AuthService } from "@/services/auth/AuthService"

describe("fetchRemoteConfig", () => {
	let sandbox: sinon.SinonSandbox
	let accountService: ClineAccountService
	let authServiceStub: Partial<AuthService>
	let fetchUserRemoteConfigStub: sinon.SinonStub
	let isRemoteConfigEnabledStub: sinon.SinonStub

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		authServiceStub = {}
		sandbox.stub(AuthService, "getInstance").returns(authServiceStub as AuthService)
		accountService = new ClineAccountService()
		sandbox.stub(ClineAccountService, "getInstance").returns(accountService)
		fetchUserRemoteConfigStub = sandbox.stub(accountService, "fetchUserRemoteConfig")
		isRemoteConfigEnabledStub = sandbox.stub(remoteConfigUtils, "isRemoteConfigEnabled").returns(true)
		sandbox.stub(remoteConfigUtils, "applyRemoteConfig").resolves()
		sandbox.stub(remoteConfigUtils, "clearRemoteConfig")
		sandbox.stub(diskStorage, "writeRemoteConfigToCache").resolves()
		sandbox.stub(diskStorage, "readRemoteConfigFromCache").resolves({ version: "v1" })
		sandbox.stub(diskStorage, "deleteRemoteConfigFromCache").resolves()
	})

	afterEach(() => {
		sandbox.restore()
	})

	it("switches org when not in the chosen org", async () => {
		Object.assign(authServiceStub, {
			getActiveOrganizationId: () => "org-current",
		})

		fetchUserRemoteConfigStub.resolves({
			organizationId: "org-target",
			value: '{"version":"v1"}',
			organizations: [{ organizationId: "org-target", name: "Target Org" }],
		})

		const controller = {
			accountService: { switchAccount: sandbox.stub().resolves() },
			stateManager: { setSecret: sandbox.stub() },
			mcpHub: {},
			postStateToWebview: sandbox.stub(),
		}

		await remoteConfigFetch.fetchRemoteConfig(controller as any)

		assert.strictEqual(controller.accountService.switchAccount.callCount, 1)
		assert.strictEqual(controller.accountService.switchAccount.firstCall.args[0], "org-target")
		assert.ok((remoteConfigUtils.applyRemoteConfig as sinon.SinonStub).calledOnce)
	})

	it("skips switchAccount when already in the chosen org", async () => {
		Object.assign(authServiceStub, {
			getActiveOrganizationId: () => "org-target",
		})

		fetchUserRemoteConfigStub.resolves({
			organizationId: "org-target",
			value: '{"version":"v1"}',
			organizations: [{ organizationId: "org-target", name: "Target Org" }],
		})

		const controller = {
			accountService: { switchAccount: sandbox.stub() },
			stateManager: { setSecret: sandbox.stub() },
			mcpHub: {},
			postStateToWebview: sandbox.stub(),
		}

		await remoteConfigFetch.fetchRemoteConfig(controller as any)

		assert.strictEqual(controller.accountService.switchAccount.callCount, 0)
		assert.ok((remoteConfigUtils.applyRemoteConfig as sinon.SinonStub).calledOnce)
	})

	it("uses discoveredValue inline and skips org-level config fetch", async () => {
		Object.assign(authServiceStub, {
			getActiveOrganizationId: () => "org-target",
			getAuthToken: () => Promise.resolve("token"),
		})

		fetchUserRemoteConfigStub.resolves({
			organizationId: "org-target",
			value: '{"version":"v1"}',
			organizations: [{ organizationId: "org-target", name: "Target Org" }],
		})

		const controller = {
			accountService: { switchAccount: sandbox.stub() },
			stateManager: { setSecret: sandbox.stub() },
			mcpHub: {},
			postStateToWebview: sandbox.stub(),
		}

		await remoteConfigFetch.fetchRemoteConfig(controller as any)

		assert.ok((remoteConfigUtils.applyRemoteConfig as sinon.SinonStub).calledOnce)
		// writeRemoteConfigToCache is called with the parsed config, proving inline parse succeeded.
		// If it had fallen through to fetchRemoteConfigForOrganization, it would need getAuthToken
		// and make an HTTP call — but no axios stub is set up, so the test would fail.
		assert.ok((diskStorage.writeRemoteConfigToCache as sinon.SinonStub).calledOnce)
	})

	it("falls back to org-level fetch when discoveredValue fails to parse", async () => {
		Object.assign(authServiceStub, {
			getActiveOrganizationId: () => "org-target",
			getAuthToken: () => Promise.resolve(null),
		})

		fetchUserRemoteConfigStub.resolves({
			organizationId: "org-target",
			value: "not valid json{{{",
			organizations: [{ organizationId: "org-target", name: "Target Org" }],
		})

		const controller = {
			accountService: { switchAccount: sandbox.stub() },
			stateManager: { setSecret: sandbox.stub() },
			mcpHub: {},
			postStateToWebview: sandbox.stub(),
		}

		await remoteConfigFetch.fetchRemoteConfig(controller as any)

		// Parse failed → fetchRemoteConfigForOrganization → no auth → cache fallback
		assert.ok((diskStorage.readRemoteConfigFromCache as sinon.SinonStub).called)
		assert.ok((remoteConfigUtils.applyRemoteConfig as sinon.SinonStub).calledOnce)
	})

	it("does not switch org when resolve fails", async () => {
		Object.assign(authServiceStub, {
			getActiveOrganizationId: () => "org-current",
			getAuthToken: () => Promise.resolve(null),
		})

		fetchUserRemoteConfigStub.resolves({
			organizationId: "org-target",
			value: "not valid json{{{",
			organizations: [{ organizationId: "org-target", name: "Target Org" }],
		})

		// Both inline parse and org-level fetch fail (no auth → no fetch), cache is empty
		;(diskStorage.readRemoteConfigFromCache as sinon.SinonStub).resolves(undefined)

		const controller = {
			accountService: { switchAccount: sandbox.stub() },
			stateManager: { setSecret: sandbox.stub() },
			mcpHub: {},
			postStateToWebview: sandbox.stub(),
		}

		await remoteConfigFetch.fetchRemoteConfig(controller as any)

		// Config resolution failed — user should stay in their current org
		assert.strictEqual(controller.accountService.switchAccount.callCount, 0)
		assert.ok((remoteConfigUtils.clearRemoteConfig as sinon.SinonStub).called)
		assert.strictEqual((remoteConfigUtils.applyRemoteConfig as sinon.SinonStub).callCount, 0)
	})

	it("falls back to next locally-allowed org when backend org is opted-out", async () => {
		Object.assign(authServiceStub, {
			getActiveOrganizationId: () => "org-3",
			getAuthToken: () => Promise.resolve("token"),
		})

		fetchUserRemoteConfigStub.resolves({
			organizationId: "org-1",
			value: '{"version":"v1"}',
			organizations: [
				{ organizationId: "org-1", name: "Org 1" },
				{ organizationId: "org-2", name: "Org 2" },
				{ organizationId: "org-3", name: "Org 3" },
			],
		})
		isRemoteConfigEnabledStub.reset()
		isRemoteConfigEnabledStub.withArgs("org-1").returns(false)
		isRemoteConfigEnabledStub.withArgs("org-2").returns(false)
		isRemoteConfigEnabledStub.withArgs("org-3").returns(true)
		// Fallback org has no discoveredValue, so it will go through fetchRemoteConfigForOrganization
		// which needs auth → will fall back to cache
		;(diskStorage.readRemoteConfigFromCache as sinon.SinonStub).resolves({ version: "v1" })

		const controller = {
			accountService: { switchAccount: sandbox.stub().resolves() },
			stateManager: { setSecret: sandbox.stub() },
			mcpHub: {},
			postStateToWebview: sandbox.stub(),
		}

		await remoteConfigFetch.fetchRemoteConfig(controller as any)

		assert.ok((remoteConfigUtils.applyRemoteConfig as sinon.SinonStub).calledOnce)
	})

	it("clears remote config when all orgs are locally opted-out", async () => {
		fetchUserRemoteConfigStub.resolves({
			organizationId: "org-1",
			value: '{"version":"v1"}',
			organizations: [
				{ organizationId: "org-1", name: "Org 1" },
				{ organizationId: "org-2", name: "Org 2" },
			],
		})
		isRemoteConfigEnabledStub.reset()
		isRemoteConfigEnabledStub.returns(false)

		const controller = {
			accountService: { switchAccount: sandbox.stub() },
			stateManager: { setSecret: sandbox.stub() },
			mcpHub: {},
			postStateToWebview: sandbox.stub(),
		}

		await remoteConfigFetch.fetchRemoteConfig(controller as any)

		assert.ok((remoteConfigUtils.clearRemoteConfig as sinon.SinonStub).called)
		assert.strictEqual(controller.accountService.switchAccount.callCount, 0)
		assert.strictEqual((remoteConfigUtils.applyRemoteConfig as sinon.SinonStub).callCount, 0)
	})

	it("calls clearRemoteConfig when discovery returns no qualifying org", async () => {
		fetchUserRemoteConfigStub.resolves(undefined)

		const controller = {
			accountService: { switchAccount: sandbox.stub() },
			stateManager: { setSecret: sandbox.stub() },
			mcpHub: {},
			postStateToWebview: sandbox.stub(),
		}

		await remoteConfigFetch.fetchRemoteConfig(controller as any)

		assert.ok((remoteConfigUtils.clearRemoteConfig as sinon.SinonStub).called)
		assert.strictEqual(controller.accountService.switchAccount.callCount, 0)
		assert.strictEqual((remoteConfigUtils.applyRemoteConfig as sinon.SinonStub).callCount, 0)
	})

	it("clears remote config when isRemoteConfigEnabled toggled off mid-flight", async () => {
		Object.assign(authServiceStub, {
			getActiveOrganizationId: () => "org-target",
		})

		fetchUserRemoteConfigStub.resolves({
			organizationId: "org-target",
			value: '{"version":"v1"}',
			organizations: [{ organizationId: "org-target", name: "Target Org" }],
		})

		isRemoteConfigEnabledStub.reset()
		isRemoteConfigEnabledStub.onFirstCall().returns(true)
		isRemoteConfigEnabledStub.onSecondCall().returns(false)

		const controller = {
			accountService: { switchAccount: sandbox.stub() },
			stateManager: { setSecret: sandbox.stub() },
			mcpHub: {},
			postStateToWebview: sandbox.stub(),
		}

		await remoteConfigFetch.fetchRemoteConfig(controller as any)

		assert.ok((diskStorage.writeRemoteConfigToCache as sinon.SinonStub).calledOnce)
		assert.ok((remoteConfigUtils.clearRemoteConfig as sinon.SinonStub).called)
		assert.strictEqual((remoteConfigUtils.applyRemoteConfig as sinon.SinonStub).callCount, 0)
	})

	it("preserves existing config on unexpected network error", async () => {
		fetchUserRemoteConfigStub.rejects(new Error("network failure"))

		const controller = {
			accountService: { switchAccount: sandbox.stub() },
			stateManager: { setSecret: sandbox.stub() },
			mcpHub: {},
			postStateToWebview: sandbox.stub(),
		}

		await remoteConfigFetch.fetchRemoteConfig(controller as any)

		// Transient errors should NOT clear existing remote config
		assert.strictEqual((remoteConfigUtils.clearRemoteConfig as sinon.SinonStub).callCount, 0)
		assert.strictEqual(controller.postStateToWebview.callCount, 0)
	})

	it("preserves existing config when switchAccount rejects", async () => {
		Object.assign(authServiceStub, {
			getActiveOrganizationId: () => "org-current",
		})

		fetchUserRemoteConfigStub.resolves({
			organizationId: "org-target",
			value: '{"version":"v1"}',
			organizations: [{ organizationId: "org-target", name: "Target Org" }],
		})

		const controller = {
			accountService: { switchAccount: sandbox.stub().rejects(new Error("switch failed")) },
			stateManager: { setSecret: sandbox.stub() },
			mcpHub: {},
			postStateToWebview: sandbox.stub(),
		}

		await remoteConfigFetch.fetchRemoteConfig(controller as any)

		// switchAccount failure should NOT clear existing remote config
		assert.strictEqual((remoteConfigUtils.clearRemoteConfig as sinon.SinonStub).callCount, 0)
		assert.strictEqual((remoteConfigUtils.applyRemoteConfig as sinon.SinonStub).callCount, 0)
	})
})
