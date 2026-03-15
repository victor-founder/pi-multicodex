import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Api, Model } from "@mariozechner/pi-ai";
import type {
	ExtensionCommandContext,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { getSettingsListTheme } from "@mariozechner/pi-coding-agent";
import {
	Container,
	type SettingItem,
	SettingsList,
	Text,
} from "@mariozechner/pi-tui";
import type { AccountManager } from "./account-manager";
import { PROVIDER_ID } from "./provider";
import type { CodexUsageSnapshot } from "./usage";

const STATUS_KEY = "multicodex-usage";
const SETTINGS_KEY = "pi-multicodex";
const SETTINGS_FILE = path.join(os.homedir(), ".pi", "agent", "settings.json");
const REFRESH_INTERVAL_MS = 60_000;
const UNKNOWN_PERCENT = "--";
const FIVE_HOUR_LABEL = "5h:";
const SEVEN_DAY_LABEL = "7d:";

type MaybeModel = Model<Api> | undefined;
export type PercentDisplayMode = "left" | "used";
export type ResetWindowMode = "5h" | "7d" | "both";
export type StatusOrder = "account-first" | "usage-first";

export interface FooterPreferences {
	usageMode: PercentDisplayMode;
	resetWindow: ResetWindowMode;
	showAccount: boolean;
	showReset: boolean;
	order: StatusOrder;
}

const DEFAULT_PREFERENCES: FooterPreferences = {
	usageMode: "left",
	resetWindow: "7d",
	showAccount: true,
	showReset: true,
	order: "account-first",
};

function asObject(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function isPercentDisplayMode(value: unknown): value is PercentDisplayMode {
	return value === "left" || value === "used";
}

function isResetWindowMode(value: unknown): value is ResetWindowMode {
	return value === "5h" || value === "7d" || value === "both";
}

function isStatusOrder(value: unknown): value is StatusOrder {
	return value === "account-first" || value === "usage-first";
}

function normalizePreferences(value: unknown): FooterPreferences {
	const record = asObject(value);
	return {
		usageMode: isPercentDisplayMode(record?.usageMode)
			? record.usageMode
			: DEFAULT_PREFERENCES.usageMode,
		resetWindow: isResetWindowMode(record?.resetWindow)
			? record.resetWindow
			: DEFAULT_PREFERENCES.resetWindow,
		showAccount:
			typeof record?.showAccount === "boolean"
				? record.showAccount
				: DEFAULT_PREFERENCES.showAccount,
		showReset:
			typeof record?.showReset === "boolean"
				? record.showReset
				: DEFAULT_PREFERENCES.showReset,
		order: isStatusOrder(record?.order)
			? record.order
			: DEFAULT_PREFERENCES.order,
	};
}

async function readSettingsFile(): Promise<Record<string, unknown>> {
	try {
		const raw = await fs.readFile(SETTINGS_FILE, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		return asObject(parsed) ?? {};
	} catch (error) {
		const withCode = error as Error & { code?: string };
		if (withCode.code === "ENOENT") return {};
		throw error;
	}
}

async function writeSettingsFile(
	settings: Record<string, unknown>,
): Promise<void> {
	await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
	await fs.writeFile(
		SETTINGS_FILE,
		`${JSON.stringify(settings, null, 2)}\n`,
		"utf8",
	);
}

export async function loadFooterPreferences(): Promise<FooterPreferences> {
	const settings = await readSettingsFile();
	return normalizePreferences(settings[SETTINGS_KEY]);
}

export async function persistFooterPreferences(
	preferences: FooterPreferences,
): Promise<void> {
	const settings = await readSettingsFile();
	settings[SETTINGS_KEY] = {
		...asObject(settings[SETTINGS_KEY]),
		...preferences,
	};
	await writeSettingsFile(settings);
}

function clampPercent(value: number): number {
	return Math.min(100, Math.max(0, value));
}

function usedToDisplayPercent(
	value: number | undefined,
	mode: PercentDisplayMode,
): number | undefined {
	if (typeof value !== "number" || Number.isNaN(value)) return undefined;
	const left = clampPercent(100 - value);
	return mode === "left" ? left : clampPercent(100 - left);
}

function formatPercent(
	ctx: ExtensionContext,
	displayPercent: number | undefined,
	mode: PercentDisplayMode,
): string {
	if (typeof displayPercent !== "number" || Number.isNaN(displayPercent)) {
		return ctx.ui.theme.fg("muted", UNKNOWN_PERCENT);
	}

	const text = `${Math.round(clampPercent(displayPercent))}% ${mode}`;
	if (mode === "left") {
		if (displayPercent <= 10) return ctx.ui.theme.fg("error", text);
		if (displayPercent <= 25) return ctx.ui.theme.fg("warning", text);
		return ctx.ui.theme.fg("success", text);
	}

	if (displayPercent >= 90) return ctx.ui.theme.fg("error", text);
	if (displayPercent >= 75) return ctx.ui.theme.fg("warning", text);
	return ctx.ui.theme.fg("success", text);
}

function formatResetCountdown(resetAt: number | undefined): string | undefined {
	if (typeof resetAt !== "number" || Number.isNaN(resetAt)) return undefined;
	const totalSeconds = Math.max(0, Math.round((resetAt - Date.now()) / 1000));
	const days = Math.floor(totalSeconds / 86_400);
	const hours = Math.floor((totalSeconds % 86_400) / 3_600);
	const minutes = Math.floor((totalSeconds % 3_600) / 60);
	const seconds = totalSeconds % 60;
	if (days > 0) return `${days}d${hours}h`;
	if (hours > 0) return `${hours}h${minutes}m`;
	if (minutes > 0) return `${minutes}m`;
	return `${seconds}s`;
}

export function isManagedModel(model: MaybeModel): boolean {
	return model?.provider === PROVIDER_ID;
}

export function formatActiveAccountStatus(
	ctx: ExtensionContext,
	accountEmail: string,
	usage: CodexUsageSnapshot | undefined,
	preferences: FooterPreferences,
): string {
	const accountText = preferences.showAccount
		? ctx.ui.theme.fg("muted", accountEmail)
		: undefined;
	if (!usage) {
		return [
			ctx.ui.theme.fg("dim", "Codex"),
			accountText,
			ctx.ui.theme.fg("dim", "loading..."),
		]
			.filter(Boolean)
			.join(" ");
	}

	const fiveHour = `${ctx.ui.theme.fg("dim", FIVE_HOUR_LABEL)}${formatPercent(
		ctx,
		usedToDisplayPercent(usage.primary?.usedPercent, preferences.usageMode),
		preferences.usageMode,
	)}`;
	const sevenDay = `${ctx.ui.theme.fg("dim", SEVEN_DAY_LABEL)}${formatPercent(
		ctx,
		usedToDisplayPercent(usage.secondary?.usedPercent, preferences.usageMode),
		preferences.usageMode,
	)}`;
	const fiveHourReset = preferences.showReset
		? formatResetCountdown(usage.primary?.resetAt)
		: undefined;
	const sevenDayReset = preferences.showReset
		? formatResetCountdown(usage.secondary?.resetAt)
		: undefined;
	const resetText =
		preferences.resetWindow === "5h"
			? fiveHourReset
				? ctx.ui.theme.fg("dim", `(${FIVE_HOUR_LABEL}↺${fiveHourReset})`)
				: undefined
			: preferences.resetWindow === "7d"
				? sevenDayReset
					? ctx.ui.theme.fg("dim", `(${SEVEN_DAY_LABEL}↺${sevenDayReset})`)
					: undefined
				: [
						fiveHourReset
							? ctx.ui.theme.fg("dim", `(${FIVE_HOUR_LABEL}↺${fiveHourReset})`)
							: undefined,
						sevenDayReset
							? ctx.ui.theme.fg("dim", `(${SEVEN_DAY_LABEL}↺${sevenDayReset})`)
							: undefined,
					]
						.filter(Boolean)
						.join(" ") || undefined;

	const leading =
		preferences.order === "account-first"
			? [ctx.ui.theme.fg("dim", "Codex"), accountText]
			: [ctx.ui.theme.fg("dim", "Codex")];
	const trailing =
		preferences.order === "account-first" ? [] : [accountText].filter(Boolean);

	return [...leading, fiveHour, sevenDay, resetText, ...trailing]
		.filter(Boolean)
		.join(" ");
}

function getBooleanLabel(value: boolean): string {
	return value ? "on" : "off";
}

function createSettingsItems(preferences: FooterPreferences): SettingItem[] {
	return [
		{
			id: "usageMode",
			label: "Usage display",
			description: "Show remaining or consumed quota percentages",
			currentValue: preferences.usageMode,
			values: ["left", "used"],
		},
		{
			id: "resetWindow",
			label: "Reset countdown window",
			description:
				"Choose whether the footer shows the 5h countdown, the 7d countdown, or both",
			currentValue: preferences.resetWindow,
			values: ["5h", "7d", "both"],
		},
		{
			id: "showAccount",
			label: "Show account",
			description: "Display the active account identifier in the footer",
			currentValue: getBooleanLabel(preferences.showAccount),
			values: ["on", "off"],
		},
		{
			id: "showReset",
			label: "Show reset countdown",
			description:
				"Display a reset countdown like the codex usage footer extension",
			currentValue: getBooleanLabel(preferences.showReset),
			values: ["on", "off"],
		},
		{
			id: "order",
			label: "Footer order",
			description:
				"Choose whether the account appears before or after usage fields",
			currentValue: preferences.order,
			values: ["account-first", "usage-first"],
		},
	];
}

function applyPreferenceChange(
	preferences: FooterPreferences,
	id: string,
	newValue: string,
): FooterPreferences {
	if (id === "usageMode" && isPercentDisplayMode(newValue)) {
		return { ...preferences, usageMode: newValue };
	}
	if (id === "resetWindow" && isResetWindowMode(newValue)) {
		return { ...preferences, resetWindow: newValue };
	}
	if (id === "showAccount") {
		return { ...preferences, showAccount: newValue === "on" };
	}
	if (id === "showReset") {
		return { ...preferences, showReset: newValue === "on" };
	}
	if (id === "order" && isStatusOrder(newValue)) {
		return { ...preferences, order: newValue };
	}
	return preferences;
}

export function createUsageStatusController(accountManager: AccountManager) {
	let refreshTimer: ReturnType<typeof setInterval> | undefined;
	let activeContext: ExtensionContext | undefined;
	let refreshInFlight = false;
	let queuedRefresh = false;
	let preferences: FooterPreferences = DEFAULT_PREFERENCES;

	function clearStatus(ctx?: ExtensionContext): void {
		ctx?.ui.setStatus(STATUS_KEY, undefined);
	}

	async function ensurePreferencesLoaded(): Promise<void> {
		preferences = await loadFooterPreferences();
	}

	async function updateStatus(ctx: ExtensionContext): Promise<void> {
		if (!ctx.hasUI) return;
		if (!isManagedModel(ctx.model)) {
			clearStatus(ctx);
			return;
		}

		let activeAccount = accountManager.getActiveAccount();
		if (!activeAccount) {
			await accountManager.syncImportedOpenAICodexAuth();
			activeAccount = accountManager.getActiveAccount();
		}
		if (!activeAccount) {
			ctx.ui.setStatus(
				STATUS_KEY,
				ctx.ui.theme.fg("warning", "Multicodex no active account"),
			);
			return;
		}

		const cachedUsage = accountManager.getCachedUsage(activeAccount.email);
		const usage =
			(await accountManager.refreshUsageForAccount(activeAccount)) ??
			cachedUsage;
		ctx.ui.setStatus(
			STATUS_KEY,
			formatActiveAccountStatus(ctx, activeAccount.email, usage, preferences),
		);
	}

	async function refreshFor(ctx: ExtensionContext): Promise<void> {
		activeContext = ctx;
		if (refreshInFlight) {
			queuedRefresh = true;
			return;
		}

		refreshInFlight = true;
		try {
			await updateStatus(ctx);
		} finally {
			refreshInFlight = false;
			if (queuedRefresh && activeContext) {
				queuedRefresh = false;
				await refreshFor(activeContext);
			}
		}
	}

	function startAutoRefresh(): void {
		if (refreshTimer) clearInterval(refreshTimer);
		refreshTimer = setInterval(() => {
			if (!activeContext) return;
			void refreshFor(activeContext);
		}, REFRESH_INTERVAL_MS);
		refreshTimer.unref?.();
	}

	function stopAutoRefresh(ctx?: ExtensionContext): void {
		if (refreshTimer) {
			clearInterval(refreshTimer);
			refreshTimer = undefined;
		}
		clearStatus(ctx ?? activeContext);
		activeContext = undefined;
		queuedRefresh = false;
	}

	async function loadPreferences(ctx?: ExtensionContext): Promise<void> {
		try {
			await ensurePreferencesLoaded();
		} catch (error) {
			preferences = DEFAULT_PREFERENCES;
			ctx?.ui.notify(
				`Multicodex: failed to load ${SETTINGS_FILE}: ${String(error)}`,
				"warning",
			);
		}
	}

	async function openPreferencesPanel(
		ctx: ExtensionCommandContext,
	): Promise<void> {
		await loadPreferences(ctx);
		let draft = preferences;

		await ctx.ui.custom((_tui, theme, _kb, done) => {
			const container = new Container();
			container.addChild(
				new Text(theme.fg("accent", theme.bold("MultiCodex Footer")), 1, 0),
			);
			container.addChild(
				new Text(
					theme.fg(
						"dim",
						"Configure the usage footer to match the codex usage extension style.",
					),
					1,
					0,
				),
			);

			const settingsList = new SettingsList(
				createSettingsItems(draft),
				7,
				getSettingsListTheme(),
				(id: string, newValue: string) => {
					draft = applyPreferenceChange(draft, id, newValue);
					settingsList.updateValue(id, newValue);
				},
				() => done(undefined),
				{ enableSearch: true },
			);
			container.addChild(settingsList);

			return {
				render: (width: number) => container.render(width),
				invalidate: () => container.invalidate(),
				handleInput: (data: string) => settingsList.handleInput(data),
			};
		});

		preferences = draft;
		await persistFooterPreferences(preferences);
		await refreshFor(ctx);
	}

	return {
		loadPreferences,
		openPreferencesPanel,
		refreshFor,
		startAutoRefresh,
		stopAutoRefresh,
		getPreferences: () => preferences,
	};
}
