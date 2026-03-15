import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	registerCommands: vi.fn(),
	handleSessionStart: vi.fn(),
	handleNewSessionSwitch: vi.fn(),
	buildMulticodexProviderConfig: vi.fn(() => ({ mocked: true })),
	setWarningHandler: vi.fn(),
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
	PROVIDER_ID: "multicodex",
	buildMulticodexProviderConfig: mocks.buildMulticodexProviderConfig,
}));

import multicodexExtension from "./extension";

describe("multicodexExtension", () => {
	beforeEach(() => {
		mocks.registerCommands.mockClear();
		mocks.handleSessionStart.mockClear();
		mocks.handleNewSessionSwitch.mockClear();
		mocks.buildMulticodexProviderConfig.mockClear();
		mocks.setWarningHandler.mockClear();
	});

	it("registers provider, commands, and session hooks", () => {
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
		expect(registerProvider).toHaveBeenCalledWith("multicodex", {
			mocked: true,
		});
		expect(mocks.registerCommands).toHaveBeenCalledOnce();
		expect(on).toHaveBeenCalledTimes(2);
		expect(handlers.has("session_start")).toBe(true);
		expect(handlers.has("session_switch")).toBe(true);
	});

	it("routes session events to the hook helpers", () => {
		const handlers = new Map<string, (...args: unknown[]) => void>();

		multicodexExtension({
			registerProvider: vi.fn(),
			on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
				handlers.set(event, handler);
			}),
		} as never);

		const sessionStart = handlers.get("session_start");
		const sessionSwitch = handlers.get("session_switch");
		expect(sessionStart).toBeTypeOf("function");
		expect(sessionSwitch).toBeTypeOf("function");

		sessionStart?.({}, { ui: { notify: vi.fn() } });
		expect(mocks.handleSessionStart).toHaveBeenCalledOnce();

		sessionSwitch?.({ reason: "existing" }, { ui: { notify: vi.fn() } });
		expect(mocks.handleNewSessionSwitch).not.toHaveBeenCalled();

		sessionSwitch?.({ reason: "new" }, { ui: { notify: vi.fn() } });
		expect(mocks.handleNewSessionSwitch).toHaveBeenCalledOnce();
	});
});
