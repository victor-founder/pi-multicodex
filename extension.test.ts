import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	registerCommands: vi.fn(),
	handleSessionStart: vi.fn(),
	handleNewSessionSwitch: vi.fn(),
	buildMulticodexProviderConfig: vi.fn(() => ({ mocked: true })),
	setWarningHandler: vi.fn(),
	statusRefreshFor: vi.fn(),
	statusStartAutoRefresh: vi.fn(),
	statusStopAutoRefresh: vi.fn(),
	statusLoadPreferences: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./account-manager", () => ({
	AccountManager: class MockAccountManager {
		setWarningHandler = mocks.setWarningHandler;
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
		mocks.statusRefreshFor.mockClear();
		mocks.statusStartAutoRefresh.mockClear();
		mocks.statusStopAutoRefresh.mockClear();
		mocks.statusLoadPreferences.mockClear();
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
		expect(on).toHaveBeenCalledTimes(5);
		expect(handlers.has("session_start")).toBe(true);
		expect(handlers.has("session_switch")).toBe(true);
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
		const sessionSwitch = handlers.get("session_switch");
		const turnEnd = handlers.get("turn_end");
		const modelSelect = handlers.get("model_select");
		const sessionShutdown = handlers.get("session_shutdown");
		expect(sessionStart).toBeTypeOf("function");
		expect(sessionSwitch).toBeTypeOf("function");
		expect(turnEnd).toBeTypeOf("function");
		expect(modelSelect).toBeTypeOf("function");
		expect(sessionShutdown).toBeTypeOf("function");

		sessionStart?.({}, ctx as never);
		expect(mocks.handleSessionStart).toHaveBeenCalledOnce();
		expect(mocks.statusStartAutoRefresh).toHaveBeenCalledOnce();
		await vi.waitFor(() => {
			expect(mocks.statusLoadPreferences).toHaveBeenCalledWith(ctx);
			expect(mocks.statusRefreshFor).toHaveBeenCalledWith(ctx);
		});

		sessionSwitch?.({ reason: "existing" }, ctx as never);
		expect(mocks.handleNewSessionSwitch).not.toHaveBeenCalled();
		expect(mocks.statusRefreshFor).toHaveBeenCalledTimes(2);

		sessionSwitch?.({ reason: "new" }, ctx as never);
		expect(mocks.handleNewSessionSwitch).toHaveBeenCalledOnce();
		expect(mocks.statusRefreshFor).toHaveBeenCalledTimes(3);

		turnEnd?.({}, ctx as never);
		modelSelect?.({}, ctx as never);
		expect(mocks.statusRefreshFor).toHaveBeenCalledTimes(5);

		sessionShutdown?.({}, ctx as never);
		expect(mocks.statusStopAutoRefresh).toHaveBeenCalledWith(ctx);
	});
});
