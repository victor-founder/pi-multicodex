import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createUsageStatusController,
	type FooterPreferences,
	formatActiveAccountStatus,
	isManagedModel,
} from "./status";

const defaultPreferences: FooterPreferences = {
	usageMode: "left",
	resetWindow: "both",
	showAccount: true,
	showReset: true,
	order: "account-first",
};

function createContext(overrides?: {
	provider?: string;
	setStatus?: ReturnType<typeof vi.fn>;
	notify?: ReturnType<typeof vi.fn>;
	color?: (token: string, text: string) => string;
}) {
	const setStatus = overrides?.setStatus ?? vi.fn();
	const notify = overrides?.notify ?? vi.fn();
	const color = overrides?.color ?? ((_token: string, text: string) => text);
	return {
		hasUI: true,
		model: {
			provider: overrides?.provider ?? "openai-codex",
		},
		ui: {
			setStatus,
			notify,
			theme: {
				fg: color,
				bold: (text: string) => text,
			},
		},
	} as never;
}

describe("isManagedModel", () => {
	it("matches the overridden openai-codex provider", () => {
		expect(isManagedModel({ provider: "openai-codex" } as never)).toBe(true);
		expect(isManagedModel({ provider: "anthropic" } as never)).toBe(false);
		expect(isManagedModel(undefined)).toBe(false);
	});
});

describe("formatActiveAccountStatus", () => {
	it("renders account, usage, and both reset countdowns beside their matching periods", () => {
		const ctx = createContext();
		const text = formatActiveAccountStatus(
			ctx,
			"a@example.com",
			{
				primary: { usedPercent: 25, resetAt: Date.now() + 60_000 },
				secondary: { usedPercent: 60, resetAt: Date.now() + 3_600_000 },
				fetchedAt: 0,
			},
			defaultPreferences,
		);

		expect(text).toContain("Codex");
		expect(text).toContain("a@example.com");
		expect(text).toContain("5h:75% left (↺");
		expect(text).toContain("7d:40% left (↺");
		expect(text).not.toContain("(5h:↺");
		expect(text).not.toContain("(7d:↺");
	});

	it("supports hiding the account and moving it after the usage fields", () => {
		const ctx = createContext();
		const text = formatActiveAccountStatus(
			ctx,
			"a@example.com",
			{
				primary: { usedPercent: 10, resetAt: 1 },
				secondary: { usedPercent: 20, resetAt: 2 },
				fetchedAt: 0,
			},
			{
				...defaultPreferences,
				showAccount: false,
				showReset: false,
				order: "usage-first",
				usageMode: "used",
			},
		);

		expect(text).toContain("5h:10% used");
		expect(text).toContain("7d:20% used");
		expect(text).not.toContain("a@example.com");
		expect(text).not.toContain("↺");
	});

	it("colors full usage windows by severity, adds muted separators, and lifts the account text", () => {
		const ctx = createContext({
			color: (token: string, text: string) => `[${token}:${text}]`,
		});
		const text = formatActiveAccountStatus(
			ctx,
			"a@example.com",
			{
				primary: { usedPercent: 25, resetAt: Date.now() + 60_000 },
				secondary: { usedPercent: 95, resetAt: Date.now() + 120_000 },
				fetchedAt: 0,
			},
			defaultPreferences,
		);

		expect(text).toContain("[muted:Codex]");
		expect(text).toContain("[text:a@example.com]");
		expect(text).toContain("[success:5h:75% left (↺");
		expect(text).toContain("[error:7d:5% left (↺");
		expect(text).toContain("[muted:·]");
	});

	it("uses thinkingMedium for neutral used windows", () => {
		const ctx = createContext({
			color: (token: string, text: string) => `[${token}:${text}]`,
		});
		const text = formatActiveAccountStatus(
			ctx,
			"a@example.com",
			{
				primary: { usedPercent: 52, resetAt: Date.now() + 60_000 },
				secondary: { usedPercent: 96, resetAt: Date.now() + 120_000 },
				fetchedAt: 0,
			},
			{ ...defaultPreferences, usageMode: "used" },
		);

		expect(text).toContain("[thinkingMedium:5h:52% used (↺");
		expect(text).toContain("[error:7d:96% used (↺");
	});

	it("uses muted loading text and dim unknown usage windows", () => {
		const ctx = createContext({
			color: (token: string, text: string) => `[${token}:${text}]`,
		});
		const loading = formatActiveAccountStatus(
			ctx,
			"a@example.com",
			undefined,
			defaultPreferences,
		);
		const unknown = formatActiveAccountStatus(
			ctx,
			"a@example.com",
			{
				primary: { resetAt: Date.now() + 60_000 },
				secondary: { resetAt: Date.now() + 120_000 },
				fetchedAt: 0,
			},
			defaultPreferences,
		);

		expect(loading).toContain("[muted:Codex]");
		expect(loading).toContain("[muted:loading...]");
		expect(unknown).toContain("[dim:5h:-- (↺");
		expect(unknown).toContain("[dim:7d:-- (↺");
	});
});

describe("createUsageStatusController", () => {
	beforeEach(() => {
		vi.useRealTimers();
	});

	it("clears the footer when the selected model is not managed by multicodex", async () => {
		const setStatus = vi.fn();
		const controller = createUsageStatusController({
			onStateChange: () => () => undefined,
		} as never);

		await controller.refreshFor(
			createContext({ provider: "anthropic", setStatus }),
		);

		expect(setStatus).toHaveBeenCalledWith("multicodex-usage", undefined);
	});

	it("renders active-account usage for managed models", async () => {
		const setStatus = vi.fn();
		const controller = createUsageStatusController({
			onStateChange: () => () => undefined,
			getActiveAccount: () => ({ email: "a@example.com" }),
			getCachedUsage: vi.fn(),
			refreshUsageForAccount: vi.fn().mockResolvedValue({
				primary: { usedPercent: 10, resetAt: 1 },
				secondary: { usedPercent: 20, resetAt: 2 },
				fetchedAt: 0,
			}),
		} as never);

		await controller.refreshFor(createContext({ setStatus }));

		expect(setStatus).toHaveBeenCalledWith(
			"multicodex-usage",
			expect.stringContaining("a@example.com"),
		);
		expect(setStatus).toHaveBeenCalledWith(
			"multicodex-usage",
			expect.stringContaining("5h:90% left"),
		);
		expect(setStatus).toHaveBeenCalledWith(
			"multicodex-usage",
			expect.stringContaining("7d:80% left"),
		);
	});

	it("falls back to cached usage when refreshing fails", async () => {
		const setStatus = vi.fn();
		const controller = createUsageStatusController({
			onStateChange: () => () => undefined,
			getActiveAccount: () => ({ email: "a@example.com" }),
			getCachedUsage: () => ({
				primary: { usedPercent: 30, resetAt: 1 },
				secondary: { usedPercent: 40, resetAt: 2 },
				fetchedAt: 0,
			}),
			refreshUsageForAccount: vi.fn().mockResolvedValue(undefined),
		} as never);

		await controller.refreshFor(createContext({ setStatus }));

		expect(setStatus).toHaveBeenCalledWith(
			"multicodex-usage",
			expect.stringContaining("5h:70% left"),
		);
		expect(setStatus).toHaveBeenCalledWith(
			"multicodex-usage",
			expect.stringContaining("7d:60% left"),
		);
	});

	it("debounces model-select refreshes while rendering cached usage immediately", async () => {
		vi.useFakeTimers();
		const setStatus = vi.fn();
		const refreshUsageForAccount = vi.fn().mockResolvedValue({
			primary: { usedPercent: 10, resetAt: 1 },
			secondary: { usedPercent: 20, resetAt: 2 },
			fetchedAt: 0,
		});
		const controller = createUsageStatusController({
			onStateChange: () => () => undefined,
			getActiveAccount: () => ({ email: "a@example.com" }),
			getCachedUsage: () => ({
				primary: { usedPercent: 30, resetAt: 1 },
				secondary: { usedPercent: 40, resetAt: 2 },
				fetchedAt: 0,
			}),
			refreshUsageForAccount,
		} as never);
		const ctx = createContext({ setStatus });

		controller.scheduleModelSelectRefresh(ctx);
		controller.scheduleModelSelectRefresh(ctx);

		expect(setStatus).toHaveBeenCalledWith(
			"multicodex-usage",
			expect.stringContaining("5h:70% left"),
		);
		expect(refreshUsageForAccount).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(250);

		expect(refreshUsageForAccount).toHaveBeenCalledTimes(1);
	});

	it("clears the footer immediately on model-select when the selected model is not codex", () => {
		vi.useFakeTimers();
		const setStatus = vi.fn();
		const refreshUsageForAccount = vi.fn();
		const controller = createUsageStatusController({
			onStateChange: () => () => undefined,
			getActiveAccount: () => ({ email: "a@example.com" }),
			getCachedUsage: () => ({
				primary: { usedPercent: 30, resetAt: 1 },
				secondary: { usedPercent: 40, resetAt: 2 },
				fetchedAt: 0,
			}),
			refreshUsageForAccount,
		} as never);
		const ctx = createContext({ provider: "anthropic", setStatus });

		controller.scheduleModelSelectRefresh(ctx);

		expect(setStatus).toHaveBeenCalledWith("multicodex-usage", undefined);
		expect(refreshUsageForAccount).not.toHaveBeenCalled();
	});

	it("re-renders from cached state when the account manager reports a state change", async () => {
		const setStatus = vi.fn();
		let stateChangeHandler: (() => void) | undefined;
		let activeEmail = "a@example.com";
		const usages = new Map([
			[
				"a@example.com",
				{
					primary: { usedPercent: 30, resetAt: 1 },
					secondary: { usedPercent: 40, resetAt: 2 },
					fetchedAt: 0,
				},
			],
			[
				"b@example.com",
				{
					primary: { usedPercent: 5, resetAt: 1 },
					secondary: { usedPercent: 10, resetAt: 2 },
					fetchedAt: 0,
				},
			],
		]);
		const controller = createUsageStatusController({
			onStateChange: (handler: () => void) => {
				stateChangeHandler = handler;
				return () => undefined;
			},
			getActiveAccount: () => ({ email: activeEmail }),
			getCachedUsage: (email: string) => usages.get(email),
			refreshUsageForAccount: vi
				.fn()
				.mockImplementation(async () => usages.get(activeEmail)),
		} as never);
		const ctx = createContext({ setStatus });

		await controller.refreshFor(ctx);
		activeEmail = "b@example.com";
		stateChangeHandler?.();

		expect(setStatus).toHaveBeenLastCalledWith(
			"multicodex-usage",
			expect.stringContaining("b@example.com"),
		);
		expect(setStatus).toHaveBeenLastCalledWith(
			"multicodex-usage",
			expect.stringContaining("5h:95% left"),
		);
	});
});
