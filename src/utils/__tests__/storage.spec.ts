import * as vscode from "vscode"

vi.mock("fs/promises", async () => {
	const mod = await import("../../__mocks__/fs/promises")
	return (mod as any).default ?? mod
})

describe("getStorageBasePath - customStoragePath", () => {
	const defaultPath = "/test/global-storage"

	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("returns the configured custom path when it is writable", async () => {
		const customPath = "/test/storage/path"
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
			get: vi.fn().mockReturnValue(customPath),
		} as any)

		const fsPromises = await import("fs/promises")
		const { getStorageBasePath } = await import("../storage")

		const result = await getStorageBasePath(defaultPath)

		expect(result).toBe(customPath)
		expect((fsPromises as any).mkdir).toHaveBeenCalledWith(customPath, { recursive: true })
		expect((fsPromises as any).access).toHaveBeenCalledWith(customPath, 7) // 7 = R_OK(4) | W_OK(2) | X_OK(1)
	})

	it("falls back to default and shows an error when custom path is not writable", async () => {
		const customPath = "/test/storage/unwritable"

		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
			get: vi.fn().mockReturnValue(customPath),
		} as any)

		const showErrorSpy = vi.spyOn(vscode.window, "showErrorMessage").mockResolvedValue(undefined as any)

		const fsPromises = await import("fs/promises")
		const { getStorageBasePath } = await import("../storage")

		await (fsPromises as any).mkdir(customPath, { recursive: true })

		const accessMock = (fsPromises as any).access as ReturnType<typeof vi.fn>
		accessMock.mockImplementationOnce(async (p: string) => {
			if (p === customPath) {
				const err: any = new Error("EACCES: permission denied")
				err.code = "EACCES"
				throw err
			}
			return Promise.resolve()
		})

		const result = await getStorageBasePath(defaultPath)

		expect(result).toBe(defaultPath)
		expect(showErrorSpy).toHaveBeenCalledTimes(1)
		const firstArg = showErrorSpy.mock.calls[0][0]
		expect(typeof firstArg).toBe("string")
	})
	it("returns the default path when customStoragePath is an empty string and does not touch fs", async () => {
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
			get: vi.fn().mockReturnValue(""),
		} as any)

		const fsPromises = await import("fs/promises")
		const { getStorageBasePath } = await import("../storage")

		const result = await getStorageBasePath(defaultPath)

		expect(result).toBe(defaultPath)
		expect((fsPromises as any).mkdir).not.toHaveBeenCalled()
		expect((fsPromises as any).access).not.toHaveBeenCalled()
	})

	it("falls back to default when mkdir fails and does not attempt access", async () => {
		const customPath = "/test/storage/failmkdir"

		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
			get: vi.fn().mockReturnValue(customPath),
		} as any)

		const showErrorSpy = vi.spyOn(vscode.window, "showErrorMessage").mockResolvedValue(undefined as any)

		const fsPromises = await import("fs/promises")
		const { getStorageBasePath } = await import("../storage")

		const mkdirMock = (fsPromises as any).mkdir as ReturnType<typeof vi.fn>
		mkdirMock.mockImplementationOnce(async (p: string) => {
			if (p === customPath) {
				const err: any = new Error("EACCES: permission denied")
				err.code = "EACCES"
				throw err
			}
			return Promise.resolve()
		})

		const result = await getStorageBasePath(defaultPath)

		expect(result).toBe(defaultPath)
		expect((fsPromises as any).access).not.toHaveBeenCalled()
		expect(showErrorSpy).toHaveBeenCalledTimes(1)
	})

	it("passes the correct permission flags (R_OK | W_OK | X_OK) to fs.access", async () => {
		const customPath = "/test/storage/path"
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
			get: vi.fn().mockReturnValue(customPath),
		} as any)

		const fsPromises = await import("fs/promises")
		const { getStorageBasePath } = await import("../storage")

		await getStorageBasePath(defaultPath)

		const constants = (fsPromises as any).constants
		const expectedFlags = constants.R_OK | constants.W_OK | constants.X_OK

		expect((fsPromises as any).access).toHaveBeenCalledWith(customPath, expectedFlags)
	})

	it("falls back when directory is readable but not writable (partial permissions)", async () => {
		const customPath = "/test/storage/readonly"
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
			get: vi.fn().mockReturnValue(customPath),
		} as any)

		const showErrorSpy = vi.spyOn(vscode.window, "showErrorMessage").mockResolvedValue(undefined as any)

		const fsPromises = await import("fs/promises")
		const { getStorageBasePath } = await import("../storage")

		const accessMock = (fsPromises as any).access as ReturnType<typeof vi.fn>
		const constants = (fsPromises as any).constants
		accessMock.mockImplementationOnce(async (p: string, mode?: number) => {
			// Simulate readable (R_OK) but not writable/executable (W_OK | X_OK)
			if (p === customPath && mode && mode & (constants.W_OK | constants.X_OK)) {
				const err: any = new Error("EACCES: permission denied")
				err.code = "EACCES"
				throw err
			}
			return Promise.resolve()
		})

		const result = await getStorageBasePath(defaultPath)

		expect(result).toBe(defaultPath)
		expect(showErrorSpy).toHaveBeenCalledTimes(1)
	})
})
