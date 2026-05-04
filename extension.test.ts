import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	registerCommands: vi.fn(),
	handleSessionStart: vi.fn(),
	handleNewSessionSwitch: vi.fn(),
	buildMulticodexProviderConfig: vi.fn(() => ({ mocked: true })),
	setWarningHandler: vi.fn(),
	resetSessionWarnings: vi.fn(),
	statusRefreshFor: vi.fn(),
	statusStartAutoRefresh: vi.fn(),
	statusStopAutoRefresh: vi.fn(),
	statusLoadPreferences: vi.fn().mockResolvedValue(undefined),
	statusScheduleModelSelectRefresh: vi.fn(),
}));

vi.mock("./account-manager", () => ({
	AccountManager: class MockAccountManager {
		setWarningHandler = mocks.setWarningHandler;
		resetSessionWarnings = mocks.resetSessionWarnings;
	},
}));

vi.mock("./commands", () => ({
	registerCommands: mocks.registerCommands,
}));

vi.mock("./hooks", () => ({
	handleNewSessionSwitch: mocks.handleNewSessionSwitch,
	handleSessionStart: mocks.handleSessionStart,
}));

vi.mock("./provider", () => ({
	PROVIDER_ID: "openai-codex",
	buildMulticodexProviderConfig: mocks.buildMulticodexProviderConfig,
}));

vi.mock("./status", () => ({
	createUsageStatusController: () => ({
		loadPreferences: mocks.statusLoadPreferences,
		refreshFor: mocks.statusRefreshFor,
		scheduleModelSelectRefresh: mocks.statusScheduleModelSelectRefresh,
		startAutoRefresh: mocks.statusStartAutoRefresh,
		stopAutoRefresh: mocks.statusStopAutoRefresh,
	}),
}));

import multicodexExtension from "./extension";

describe("multicodexExtension", () => {
	beforeEach(() => {
		mocks.registerCommands.mockClear();
		mocks.handleSessionStart.mockClear();
		mocks.handleNewSessionSwitch.mockClear();
		mocks.buildMulticodexProviderConfig.mockClear();
		mocks.setWarningHandler.mockClear();
		mocks.resetSessionWarnings.mockClear();
		mocks.statusRefreshFor.mockClear();
		mocks.statusStartAutoRefresh.mockClear();
		mocks.statusStopAutoRefresh.mockClear();
		mocks.statusLoadPreferences.mockClear();
		mocks.statusScheduleModelSelectRefresh.mockClear();
	});

	it("registers provider, commands, and lifecycle hooks", () => {
		const handlers = new Map<string, (...args: unknown[]) => void>();
		const registerProvider = vi.fn();
		const on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
			handlers.set(event, handler);
		});

		multicodexExtension({
			registerProvider,
			on,
		} as never);

		expect(mocks.setWarningHandler).toHaveBeenCalledOnce();
		expect(mocks.buildMulticodexProviderConfig).toHaveBeenCalledOnce();
		expect(registerProvider).toHaveBeenCalledWith("openai-codex", {
			mocked: true,
		});
		expect(mocks.registerCommands).toHaveBeenCalledOnce();
		expect(on).toHaveBeenCalledTimes(4);
		expect(handlers.has("session_start")).toBe(true);
		expect(handlers.has("turn_end")).toBe(true);
		expect(handlers.has("model_select")).toBe(true);
		expect(handlers.has("session_shutdown")).toBe(true);
	});

	it("routes session and status events to the helpers", async () => {
		const handlers = new Map<string, (...args: unknown[]) => void>();
		const ctx = { ui: { notify: vi.fn() } };

		multicodexExtension({
			registerProvider: vi.fn(),
			on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
				handlers.set(event, handler);
			}),
		} as never);

		const sessionStart = handlers.get("session_start");
		const turnEnd = handlers.get("turn_end");
		const modelSelect = handlers.get("model_select");
		const sessionShutdown = handlers.get("session_shutdown");
		expect(sessionStart).toBeTypeOf("function");
		expect(turnEnd).toBeTypeOf("function");
		expect(modelSelect).toBeTypeOf("function");
		expect(sessionShutdown).toBeTypeOf("function");

		sessionStart?.({ reason: "resume" }, ctx as never);
		expect(mocks.resetSessionWarnings).toHaveBeenCalledTimes(1);
		expect(mocks.handleSessionStart).toHaveBeenCalledOnce();
		expect(mocks.handleNewSessionSwitch).not.toHaveBeenCalled();
		expect(mocks.statusStartAutoRefresh).toHaveBeenCalledOnce();
		await vi.waitFor(() => {
			expect(mocks.statusLoadPreferences).toHaveBeenCalledTimes(1);
			expect(mocks.statusRefreshFor).toHaveBeenCalledTimes(1);
		});

		sessionStart?.({ reason: "new" }, ctx as never);
		expect(mocks.resetSessionWarnings).toHaveBeenCalledTimes(2);
		expect(mocks.handleNewSessionSwitch).toHaveBeenCalledOnce();
		expect(mocks.statusStartAutoRefresh).toHaveBeenCalledTimes(2);
		await vi.waitFor(() => {
			expect(mocks.statusLoadPreferences).toHaveBeenCalledTimes(2);
			expect(mocks.statusRefreshFor).toHaveBeenCalledTimes(2);
		});

		turnEnd?.({}, ctx as never);
		modelSelect?.({}, ctx as never);
		expect(mocks.statusRefreshFor).toHaveBeenCalledTimes(3);
		expect(mocks.statusScheduleModelSelectRefresh).toHaveBeenCalledWith(ctx);

		sessionShutdown?.({}, ctx as never);
		expect(mocks.statusStopAutoRefresh).toHaveBeenCalledWith(ctx);
	});
});
