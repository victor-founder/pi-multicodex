import { describe, expect, it, vi } from "vitest";
import { handleNewSessionSwitch, handleSessionStart } from "./hooks";

describe("handleSessionStart", () => {
	it("does nothing when no accounts exist", () => {
		const loadPiAuth = vi.fn();
		const refreshUsageForAllAccounts = vi.fn();
		const getAvailableManualAccount = vi.fn();
		const hasManualAccount = vi.fn();
		const clearManualAccount = vi.fn();
		const activateBestAccount = vi.fn();
		const beginInitialization = vi.fn();
		const markReady = vi.fn();

		handleSessionStart({
			getAccounts: () => [],
			loadPiAuth,
			refreshUsageForAllAccounts,
			getAvailableManualAccount,
			hasManualAccount,
			clearManualAccount,
			activateBestAccount,
			beginInitialization,
			markReady,
		} as never);

		expect(loadPiAuth).not.toHaveBeenCalled();
		expect(refreshUsageForAllAccounts).not.toHaveBeenCalled();
		expect(getAvailableManualAccount).not.toHaveBeenCalled();
		expect(hasManualAccount).not.toHaveBeenCalled();
		expect(clearManualAccount).not.toHaveBeenCalled();
		expect(activateBestAccount).not.toHaveBeenCalled();
	});

	it("refreshes and activates when accounts exist and no manual account is available", async () => {
		const loadPiAuth = vi.fn().mockResolvedValue(undefined);
		const refreshUsageForAllAccounts = vi.fn().mockResolvedValue(undefined);
		const getAvailableManualAccount = vi.fn().mockReturnValue(undefined);
		const hasManualAccount = vi.fn().mockReturnValue(false);
		const clearManualAccount = vi.fn();
		const activateBestAccount = vi.fn().mockResolvedValue(undefined);
		const beginInitialization = vi.fn();
		const markReady = vi.fn();

		handleSessionStart({
			getAccounts: () => [{ email: "a@example.com" }],
			loadPiAuth,
			isPiAuthAccount: () => false,
			refreshUsageForAllAccounts,
			getAccountsNeedingReauth: () => [],
			getAvailableManualAccount,
			hasManualAccount,
			clearManualAccount,
			activateBestAccount,
			beginInitialization,
			markReady,
		} as never);

		await vi.waitFor(() => {
			expect(beginInitialization).toHaveBeenCalled();
			expect(loadPiAuth).toHaveBeenCalled();
			expect(refreshUsageForAllAccounts).toHaveBeenCalledWith({ force: true });
			expect(getAvailableManualAccount).toHaveBeenCalled();
			expect(hasManualAccount).toHaveBeenCalled();
			expect(clearManualAccount).not.toHaveBeenCalled();
			expect(activateBestAccount).toHaveBeenCalled();
			expect(markReady).toHaveBeenCalled();
		});
	});

	it("keeps the manual account when one is available", async () => {
		const loadPiAuth = vi.fn().mockResolvedValue(undefined);
		const refreshUsageForAllAccounts = vi.fn().mockResolvedValue(undefined);
		const getAvailableManualAccount = vi
			.fn()
			.mockReturnValue({ email: "manual@example.com" });
		const hasManualAccount = vi.fn();
		const clearManualAccount = vi.fn();
		const activateBestAccount = vi.fn();
		const beginInitialization = vi.fn();
		const markReady = vi.fn();

		handleSessionStart({
			getAccounts: () => [{ email: "manual@example.com" }],
			loadPiAuth,
			isPiAuthAccount: () => false,
			refreshUsageForAllAccounts,
			getAccountsNeedingReauth: () => [],
			getAvailableManualAccount,
			hasManualAccount,
			clearManualAccount,
			activateBestAccount,
			beginInitialization,
			markReady,
		} as never);

		await vi.waitFor(() => {
			expect(beginInitialization).toHaveBeenCalled();
			expect(loadPiAuth).toHaveBeenCalled();
			expect(refreshUsageForAllAccounts).toHaveBeenCalledWith({ force: true });
			expect(getAvailableManualAccount).toHaveBeenCalled();
			expect(hasManualAccount).not.toHaveBeenCalled();
			expect(clearManualAccount).not.toHaveBeenCalled();
			expect(activateBestAccount).not.toHaveBeenCalled();
			expect(markReady).toHaveBeenCalled();
		});
	});
});

describe("handleNewSessionSwitch", () => {
	it("refreshes and clears stale manual state before activating the best account", async () => {
		const loadPiAuth = vi.fn().mockResolvedValue(undefined);
		const refreshUsageForAllAccounts = vi.fn().mockResolvedValue(undefined);
		const getAvailableManualAccount = vi.fn().mockReturnValue(undefined);
		const hasManualAccount = vi.fn().mockReturnValue(true);
		const clearManualAccount = vi.fn();
		const activateBestAccount = vi.fn().mockResolvedValue(undefined);
		const beginInitialization = vi.fn();
		const markReady = vi.fn();

		handleNewSessionSwitch({
			loadPiAuth,
			isPiAuthAccount: () => false,
			refreshUsageForAllAccounts,
			getAccountsNeedingReauth: () => [],
			getAvailableManualAccount,
			hasManualAccount,
			clearManualAccount,
			activateBestAccount,
			beginInitialization,
			markReady,
		} as never);

		await vi.waitFor(() => {
			expect(beginInitialization).toHaveBeenCalled();
			expect(loadPiAuth).toHaveBeenCalled();
			expect(refreshUsageForAllAccounts).toHaveBeenCalledWith({ force: true });
			expect(getAvailableManualAccount).toHaveBeenCalled();
			expect(hasManualAccount).toHaveBeenCalled();
			expect(clearManualAccount).toHaveBeenCalled();
			expect(activateBestAccount).toHaveBeenCalled();
			expect(markReady).toHaveBeenCalled();
		});
	});

	it("marks ready even when the refresh throws", async () => {
		const loadPiAuth = vi.fn().mockRejectedValue(new Error("network failure"));
		const beginInitialization = vi.fn();
		const markReady = vi.fn();

		handleNewSessionSwitch({
			loadPiAuth,
			isPiAuthAccount: () => false,
			refreshUsageForAllAccounts: vi.fn(),
			getAccountsNeedingReauth: () => [],
			getAvailableManualAccount: vi.fn(),
			hasManualAccount: vi.fn(),
			clearManualAccount: vi.fn(),
			activateBestAccount: vi.fn(),
			beginInitialization,
			markReady,
		} as never);

		await vi.waitFor(() => {
			expect(markReady).toHaveBeenCalled();
		});
	});
});
