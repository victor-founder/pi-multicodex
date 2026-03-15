import { describe, expect, it, vi } from "vitest";
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
}) {
	const setStatus = overrides?.setStatus ?? vi.fn();
	const notify = overrides?.notify ?? vi.fn();
	const color = (_token: string, text: string) => text;
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
	it("renders account, usage, and both reset countdowns like the codex usage footer", () => {
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
		expect(text).toContain("5h:75% left");
		expect(text).toContain("7d:40% left");
		expect(text).toContain("(5h:↺");
		expect(text).toContain("(7d:↺");
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
});

describe("createUsageStatusController", () => {
	it("clears the footer when the selected model is not managed by multicodex", async () => {
		const setStatus = vi.fn();
		const controller = createUsageStatusController({} as never);

		await controller.refreshFor(
			createContext({ provider: "anthropic", setStatus }),
		);

		expect(setStatus).toHaveBeenCalledWith("multicodex-usage", undefined);
	});

	it("renders active-account usage for managed models", async () => {
		const setStatus = vi.fn();
		const controller = createUsageStatusController({
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
});
