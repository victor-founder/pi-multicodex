import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	storageData: {
		accounts: [] as Array<Record<string, unknown>>,
		activeEmail: undefined as string | undefined,
	},
	loadImportedOpenAICodexAuth: vi.fn(),
	saveStorage: vi.fn(),
	writeActiveTokenToAuthJson: vi.fn(),
}));

vi.mock("./storage", () => ({
	loadStorage: () =>
		JSON.parse(JSON.stringify(mocks.storageData)) as {
			accounts: Array<Record<string, unknown>>;
			activeEmail?: string;
		},
	saveStorage: mocks.saveStorage,
}));

vi.mock("./auth", () => ({
	loadImportedOpenAICodexAuth: mocks.loadImportedOpenAICodexAuth,
	writeActiveTokenToAuthJson: mocks.writeActiveTokenToAuthJson,
}));

vi.mock("@mariozechner/pi-ai/oauth", () => ({
	refreshOpenAICodexToken: vi.fn(),
}));

import { AccountManager } from "./account-manager";

describe("AccountManager account deduplication", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.storageData.accounts = [];
		mocks.storageData.activeEmail = undefined;
		mocks.loadImportedOpenAICodexAuth.mockResolvedValue(undefined);
	});

	it("merges imported auth into an existing managed account without changing the active selection", async () => {
		mocks.storageData.accounts = [
			{
				email: "manual@example.com",
				accessToken: "manual-access",
				refreshToken: "shared-refresh",
				expiresAt: 100,
				accountId: "acc-123",
			},
			{
				email: "OpenAI Codex acc-123",
				accessToken: "imported-access",
				refreshToken: "shared-refresh",
				expiresAt: 90,
				accountId: "acc-123",
				importSource: "pi-openai-codex",
				importMode: "synthetic",
				importFingerprint: "old-fingerprint",
			},
		];
		mocks.storageData.activeEmail = "manual@example.com";
		mocks.loadImportedOpenAICodexAuth.mockResolvedValue({
			identifier: "OpenAI Codex acc-123",
			fingerprint: "new-fingerprint",
			credentials: {
				access: "fresh-access",
				refresh: "shared-refresh",
				expires: 200,
				accountId: "acc-123",
			},
		});

		const manager = new AccountManager();
		const changed = await manager.syncImportedOpenAICodexAuth();

		expect(changed).toBe(true);
		expect(manager.getAccounts()).toHaveLength(1);
		const account = manager.getAccount("manual@example.com");
		expect(account).toMatchObject({
			email: "manual@example.com",
			accessToken: "fresh-access",
			refreshToken: "shared-refresh",
			expiresAt: 200,
			importSource: "pi-openai-codex",
			importMode: "linked",
			importFingerprint: "new-fingerprint",
		});
		expect(manager.getAccount("OpenAI Codex acc-123")).toBeUndefined();
		expect(manager.getActiveAccount()?.email).toBe("manual@example.com");
	});

	it("reuses an imported placeholder account when the same credentials are added with a real label", () => {
		mocks.storageData.accounts = [
			{
				email: "OpenAI Codex acc-123",
				accessToken: "old-access",
				refreshToken: "shared-refresh",
				expiresAt: 100,
				accountId: "acc-123",
				importSource: "pi-openai-codex",
				importMode: "synthetic",
				importFingerprint: "fingerprint",
			},
		];

		const manager = new AccountManager();
		const account = manager.addOrUpdateAccount("real@example.com", {
			access: "new-access",
			refresh: "shared-refresh",
			expires: 300,
			accountId: "acc-123",
		});

		expect(account.email).toBe("real@example.com");
		expect(manager.getAccounts()).toHaveLength(1);
		expect(manager.getAccount("OpenAI Codex acc-123")).toBeUndefined();
		expect(manager.getAccount("real@example.com")).toMatchObject({
			email: "real@example.com",
			accessToken: "new-access",
			refreshToken: "shared-refresh",
			expiresAt: 300,
			importSource: "pi-openai-codex",
			importMode: "linked",
		});
		expect(manager.getActiveAccount()?.email).toBe("real@example.com");
	});

	it("keeps previously linked managed accounts when imported auth moves to another account", async () => {
		mocks.storageData.accounts = [
			{
				email: "victor@example.com",
				accessToken: "victor-access",
				refreshToken: "victor-refresh",
				expiresAt: 100,
				accountId: "victor",
			},
			{
				email: "gmail@example.com",
				accessToken: "gmail-access",
				refreshToken: "gmail-refresh",
				expiresAt: 100,
				accountId: "gmail",
				importSource: "pi-openai-codex",
				importMode: "linked",
				importFingerprint: "gmail-fingerprint",
			},
		];
		mocks.storageData.activeEmail = "victor@example.com";
		mocks.loadImportedOpenAICodexAuth.mockResolvedValue({
			identifier: "OpenAI Codex victor",
			fingerprint: "victor-fingerprint",
			credentials: {
				access: "victor-new-access",
				refresh: "victor-refresh",
				expires: 200,
				accountId: "victor",
			},
		});

		const manager = new AccountManager();
		const changed = await manager.syncImportedOpenAICodexAuth();

		expect(changed).toBe(true);
		expect(manager.getAccounts()).toHaveLength(2);
		expect(manager.getAccount("gmail@example.com")).toMatchObject({
			email: "gmail@example.com",
			refreshToken: "gmail-refresh",
			importSource: undefined,
			importMode: undefined,
			importFingerprint: undefined,
		});
		expect(manager.getAccount("victor@example.com")).toMatchObject({
			email: "victor@example.com",
			accessToken: "victor-new-access",
			refreshToken: "victor-refresh",
			importSource: "pi-openai-codex",
			importMode: "linked",
			importFingerprint: "victor-fingerprint",
		});
	});
});

describe("AccountManager auth-failure warnings", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.storageData.accounts = [];
		mocks.storageData.activeEmail = undefined;
		mocks.loadImportedOpenAICodexAuth.mockResolvedValue(undefined);
	});

	it("warns once per session for a skipped auth-broken account and resets on reauth", () => {
		const manager = new AccountManager();
		const warningHandler = vi.fn();
		manager.setWarningHandler(warningHandler);
		const account = manager.addOrUpdateAccount("warn@example.com", {
			access: "access",
			refresh: "refresh",
			expires: 100,
		});
		account.needsReauth = true;

		manager.notifyRotationSkipForAuthFailure(
			account,
			new Error("refresh failed"),
		);
		manager.notifyRotationSkipForAuthFailure(
			account,
			new Error("refresh failed"),
		);
		expect(warningHandler).toHaveBeenCalledTimes(1);
		expect(warningHandler.mock.calls[0]?.[0]).toContain("warn@example.com");
		expect(warningHandler.mock.calls[0]?.[0]).toContain(
			"/multicodex reauth warn@example.com",
		);

		manager.addOrUpdateAccount("warn@example.com", {
			access: "new-access",
			refresh: "refresh",
			expires: 200,
		});
		manager.notifyRotationSkipForAuthFailure(
			account,
			new Error("refresh failed again"),
		);
		expect(warningHandler).toHaveBeenCalledTimes(2);

		manager.resetSessionWarnings();
		manager.notifyRotationSkipForAuthFailure(
			account,
			new Error("refresh failed third"),
		);
		expect(warningHandler).toHaveBeenCalledTimes(3);
	});
});
