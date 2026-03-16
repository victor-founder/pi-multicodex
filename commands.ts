import { promises as fs, constants as fsConstants } from "node:fs";
import path from "node:path";
import { loginOpenAICodex } from "@mariozechner/pi-ai/oauth";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import { getSelectListTheme } from "@mariozechner/pi-coding-agent";
import {
	type AutocompleteItem,
	Container,
	Key,
	matchesKey,
	SelectList,
	Text,
} from "@mariozechner/pi-tui";
import { getAgentSettingsPath } from "@victor-software-house/pi-provider-utils/agent-paths";
import { normalizeUnknownError } from "@victor-software-house/pi-provider-utils/streams";
import type { AccountManager } from "./account-manager";
import { openLoginInBrowser } from "./browser";
import type { createUsageStatusController } from "./status";
import { STORAGE_FILE } from "./storage";
import { formatResetAt, isUsageUntouched } from "./usage";

const SETTINGS_FILE = getAgentSettingsPath();
const NO_ACCOUNTS_MESSAGE =
	"No managed accounts found. Use /multicodex use <identifier> first.";
const HELP_TEXT =
	"Usage: /multicodex [show|use [identifier]|footer|rotation|verify|path|reset [manual|quota|all]|help]";
const SUBCOMMANDS = [
	"show",
	"use",
	"footer",
	"rotation",
	"verify",
	"path",
	"reset",
	"help",
] as const;
const RESET_TARGETS = ["manual", "quota", "all"] as const;

type Subcommand = (typeof SUBCOMMANDS)[number];
type ResetTarget = (typeof RESET_TARGETS)[number];

type AccountPanelResult =
	| { action: "select"; email: string }
	| { action: "remove"; email: string }
	| undefined;

function toAutocompleteItems(values: readonly string[]): AutocompleteItem[] {
	return values.map((value) => ({ value, label: value }));
}

function parseCommandArgs(args: string): {
	subcommand: string | undefined;
	rest: string;
} {
	const trimmed = args.trim();
	if (!trimmed) {
		return { subcommand: undefined, rest: "" };
	}
	const firstSpaceIndex = trimmed.indexOf(" ");
	if (firstSpaceIndex < 0) {
		return { subcommand: trimmed.toLowerCase(), rest: "" };
	}
	return {
		subcommand: trimmed.slice(0, firstSpaceIndex).toLowerCase(),
		rest: trimmed.slice(firstSpaceIndex + 1).trim(),
	};
}

function isSubcommand(value: string): value is Subcommand {
	return SUBCOMMANDS.some((subcommand) => subcommand === value);
}

function parseResetTarget(value: string): ResetTarget | undefined {
	if (value === "manual" || value === "quota" || value === "all") {
		return value;
	}
	return undefined;
}

function getAccountLabel(email: string, quotaExhaustedUntil?: number): string {
	if (!quotaExhaustedUntil || quotaExhaustedUntil <= Date.now()) {
		return email;
	}
	return `${email} (Quota)`;
}

function formatAccountStatusLine(
	accountManager: AccountManager,
	email: string,
): string {
	const account = accountManager.getAccount(email);
	if (!account) return email;
	const usage = accountManager.getCachedUsage(account.email);
	const active = accountManager.getActiveAccount();
	const manual = accountManager.getManualAccount();
	const quotaHit =
		account.quotaExhaustedUntil && account.quotaExhaustedUntil > Date.now();
	const untouched = isUsageUntouched(usage) ? "untouched" : null;
	const imported = account.importSource ? "imported" : null;
	const tags = [
		active?.email === account.email ? "active" : null,
		manual?.email === account.email ? "manual" : null,
		quotaHit ? "quota" : null,
		untouched,
		imported,
	]
		.filter(Boolean)
		.join(", ");
	const suffix = tags ? ` (${tags})` : "";
	const primaryUsed = usage?.primary?.usedPercent;
	const secondaryUsed = usage?.secondary?.usedPercent;
	const primaryReset = usage?.primary?.resetAt;
	const secondaryReset = usage?.secondary?.resetAt;
	const primaryLabel =
		primaryUsed === undefined ? "unknown" : `${Math.round(primaryUsed)}%`;
	const secondaryLabel =
		secondaryUsed === undefined ? "unknown" : `${Math.round(secondaryUsed)}%`;
	const usageSummary = `5h ${primaryLabel} reset:${formatResetAt(primaryReset)} | weekly ${secondaryLabel} reset:${formatResetAt(secondaryReset)}`;
	return `${account.email}${suffix} - ${usageSummary}`;
}

function getSubcommandCompletions(prefix: string): AutocompleteItem[] | null {
	const matches = SUBCOMMANDS.filter((value) => value.startsWith(prefix));
	return matches.length > 0 ? toAutocompleteItems(matches) : null;
}

function getUseCompletions(
	prefix: string,
	accountManager: AccountManager,
): AutocompleteItem[] | null {
	const matches = accountManager
		.getAccounts()
		.map((account) => account.email)
		.filter((value) => value.startsWith(prefix));
	if (matches.length === 0) return null;
	return matches.map((value) => ({ value: `use ${value}`, label: value }));
}

function getResetCompletions(prefix: string): AutocompleteItem[] | null {
	const matches = RESET_TARGETS.filter((value) => value.startsWith(prefix));
	if (matches.length === 0) return null;
	return matches.map((value) => ({ value: `reset ${value}`, label: value }));
}

function getCommandCompletions(
	argumentPrefix: string,
	accountManager: AccountManager,
): AutocompleteItem[] | null {
	const trimmedStart = argumentPrefix.trimStart();
	if (!trimmedStart) {
		return toAutocompleteItems(SUBCOMMANDS);
	}

	const firstSpaceIndex = trimmedStart.indexOf(" ");
	if (firstSpaceIndex < 0) {
		return getSubcommandCompletions(trimmedStart.toLowerCase());
	}

	const subcommand = trimmedStart.slice(0, firstSpaceIndex).toLowerCase();
	const rest = trimmedStart.slice(firstSpaceIndex + 1).trimStart();

	if (subcommand === "use") {
		return getUseCompletions(rest, accountManager);
	}
	if (subcommand === "reset") {
		return getResetCompletions(rest);
	}

	return null;
}

async function loginAndActivateAccount(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	accountManager: AccountManager,
	identifier: string,
): Promise<boolean> {
	try {
		ctx.ui.notify(
			`Starting login for ${identifier}... Check your browser.`,
			"info",
		);

		const creds = await loginOpenAICodex({
			onAuth: ({ url }) => {
				void openLoginInBrowser(pi, ctx, url);
				ctx.ui.notify(`Please open this URL to login: ${url}`, "info");
				console.log(`[multicodex] Login URL: ${url}`);
			},
			onPrompt: async ({ message }) => (await ctx.ui.input(message)) || "",
		});

		accountManager.addOrUpdateAccount(identifier, creds);
		accountManager.setManualAccount(identifier);
		ctx.ui.notify(`Now using ${identifier}`, "info");
		return true;
	} catch (error) {
		ctx.ui.notify(`Login failed: ${normalizeUnknownError(error)}`, "error");
		return false;
	}
}

async function useOrLoginAccount(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	accountManager: AccountManager,
	identifier: string,
): Promise<void> {
	const existing = accountManager.getAccount(identifier);
	if (existing) {
		try {
			await accountManager.ensureValidToken(existing);
			accountManager.setManualAccount(identifier);
			ctx.ui.notify(`Now using ${identifier}`, "info");
			return;
		} catch {
			ctx.ui.notify(
				`Stored auth for ${identifier} is no longer valid. Starting login again.`,
				"warning",
			);
		}
	}

	await loginAndActivateAccount(pi, ctx, accountManager, identifier);
}

async function openAccountSelectionPanel(
	ctx: ExtensionCommandContext,
	accountManager: AccountManager,
): Promise<AccountPanelResult> {
	const accounts = accountManager.getAccounts();
	const items = accounts.map((account) => ({
		value: account.email,
		label: getAccountLabel(account.email, account.quotaExhaustedUntil),
	}));

	return ctx.ui.custom<AccountPanelResult>((_tui, theme, _kb, done) => {
		const container = new Container();
		container.addChild(
			new Text(theme.fg("accent", theme.bold("Select Account")), 1, 0),
		);
		container.addChild(
			new Text(
				theme.fg("dim", "Enter: use  Backspace: remove account  Esc: cancel"),
				1,
				0,
			),
		);

		const selectList = new SelectList(items, 10, getSelectListTheme());
		selectList.onSelect = (item) => {
			done({ action: "select", email: item.value });
		};
		selectList.onCancel = () => done(undefined);
		container.addChild(selectList);

		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				if (matchesKey(data, Key.backspace)) {
					const selected = selectList.getSelectedItem();
					if (selected) {
						done({ action: "remove", email: selected.value });
					}
					return;
				}
				selectList.handleInput(data);
			},
		};
	});
}

async function openAccountSelectionFlow(
	ctx: ExtensionCommandContext,
	accountManager: AccountManager,
	statusController: ReturnType<typeof createUsageStatusController>,
): Promise<void> {
	while (true) {
		const accounts = accountManager.getAccounts();
		if (accounts.length === 0) {
			ctx.ui.notify(NO_ACCOUNTS_MESSAGE, "warning");
			return;
		}

		const result = await openAccountSelectionPanel(ctx, accountManager);
		if (!result) return;

		if (result.action === "select") {
			accountManager.setManualAccount(result.email);
			ctx.ui.notify(`Now using ${result.email}`, "info");
			await statusController.refreshFor(ctx);
			return;
		}

		const accountToRemove = accountManager.getAccount(result.email);
		if (!accountToRemove) continue;

		const active = accountManager.getActiveAccount();
		const isActive = active?.email === result.email;
		const message = isActive
			? `Remove ${result.email}? This account is currently active and MultiCodex will switch to another account.`
			: `Remove ${result.email}?`;
		const confirmed = await ctx.ui.confirm("Remove account", message);
		if (!confirmed) continue;

		const removed = accountManager.removeAccount(result.email);
		if (!removed) continue;

		ctx.ui.notify(`Removed ${result.email}`, "info");
		await statusController.refreshFor(ctx);
	}
}

async function runShowSubcommand(
	ctx: ExtensionCommandContext,
	accountManager: AccountManager,
): Promise<void> {
	await accountManager.syncImportedOpenAICodexAuth();
	await accountManager.refreshUsageForAllAccounts();
	const accounts = accountManager.getAccounts();
	if (accounts.length === 0) {
		ctx.ui.notify(NO_ACCOUNTS_MESSAGE, "warning");
		return;
	}

	if (!ctx.hasUI) {
		const active = accountManager.getActiveAccount()?.email ?? "none";
		const manual = accountManager.getManualAccount()?.email ?? "none";
		ctx.ui.notify(
			`multicodex: accounts=${accounts.length} active=${active} manual=${manual}`,
			"info",
		);
		return;
	}

	const options = accounts.map((account) =>
		formatAccountStatusLine(accountManager, account.email),
	);
	await ctx.ui.select("MultiCodex Accounts", options);
}

async function runFooterSubcommand(
	ctx: ExtensionCommandContext,
	statusController: ReturnType<typeof createUsageStatusController>,
): Promise<void> {
	if (!ctx.hasUI) {
		await statusController.loadPreferences(ctx);
		const preferences = statusController.getPreferences();
		ctx.ui.notify(
			`footer: usageMode=${preferences.usageMode} resetWindow=${preferences.resetWindow} showAccount=${preferences.showAccount ? "on" : "off"} showReset=${preferences.showReset ? "on" : "off"} order=${preferences.order}`,
			"info",
		);
		return;
	}

	await statusController.openPreferencesPanel(ctx);
}

async function runRotationSubcommand(
	ctx: ExtensionCommandContext,
): Promise<void> {
	const lines = [
		"Rotation settings are not configurable yet.",
		"Current policy: manual account, then untouched accounts, then earliest weekly reset, then random fallback.",
		"Quota cooldown uses next known reset time, with 1 hour fallback when unknown.",
	];

	if (!ctx.hasUI) {
		ctx.ui.notify(
			"rotation: manual->untouched->earliest-weekly-reset->random, cooldown=next-reset-or-1h",
			"info",
		);
		return;
	}

	await ctx.ui.select("MultiCodex Rotation", lines);
}

async function isWritableDirectoryFor(filePath: string): Promise<boolean> {
	try {
		const directory = path.dirname(filePath);
		await fs.mkdir(directory, { recursive: true });
		await fs.access(directory, fsConstants.R_OK | fsConstants.W_OK);
		return true;
	} catch {
		return false;
	}
}

async function runVerifySubcommand(
	ctx: ExtensionCommandContext,
	accountManager: AccountManager,
	statusController: ReturnType<typeof createUsageStatusController>,
): Promise<void> {
	const storageWritable = await isWritableDirectoryFor(STORAGE_FILE);
	const settingsWritable = await isWritableDirectoryFor(SETTINGS_FILE);
	const authImported = await accountManager.syncImportedOpenAICodexAuth();
	await statusController.loadPreferences(ctx);
	const accounts = accountManager.getAccounts().length;
	const active = accountManager.getActiveAccount()?.email ?? "none";
	const ok = storageWritable && settingsWritable;

	if (!ctx.hasUI) {
		ctx.ui.notify(
			`verify: ${ok ? "PASS" : "WARN"} storage=${storageWritable ? "ok" : "fail"} settings=${settingsWritable ? "ok" : "fail"} accounts=${accounts} active=${active} authImport=${authImported ? "updated" : "unchanged"}`,
			ok ? "info" : "warning",
		);
		return;
	}

	const lines = [
		`storage directory writable: ${storageWritable ? "yes" : "no"}`,
		`settings directory writable: ${settingsWritable ? "yes" : "no"}`,
		`managed accounts: ${accounts}`,
		`active account: ${active}`,
		`auth import changed state: ${authImported ? "yes" : "no"}`,
	];
	await ctx.ui.select(`MultiCodex Verify (${ok ? "PASS" : "WARN"})`, lines);
}

async function runPathSubcommand(ctx: ExtensionCommandContext): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify(
			`paths: storage=${STORAGE_FILE} settings=${SETTINGS_FILE}`,
			"info",
		);
		return;
	}

	await ctx.ui.select("MultiCodex Paths", [
		`Managed account storage: ${STORAGE_FILE}`,
		`Extension settings: ${SETTINGS_FILE}`,
	]);
}

async function chooseResetTarget(
	ctx: ExtensionCommandContext,
	argument: string,
): Promise<ResetTarget | undefined> {
	const explicitTarget = parseResetTarget(argument.toLowerCase());
	if (explicitTarget) {
		return explicitTarget;
	}

	if (argument) {
		ctx.ui.notify(
			"Unknown reset target. Use: /multicodex reset [manual|quota|all]",
			"warning",
		);
		return undefined;
	}

	if (!ctx.hasUI) {
		return "all";
	}

	const options = [
		"manual - clear manual account override",
		"quota - clear quota cooldown markers",
		"all - clear manual override and quota cooldown markers",
	];
	const selected = await ctx.ui.select("Reset MultiCodex State", options);
	if (!selected) return undefined;
	if (selected.startsWith("manual")) return "manual";
	if (selected.startsWith("quota")) return "quota";
	return "all";
}

async function runResetSubcommand(
	ctx: ExtensionCommandContext,
	accountManager: AccountManager,
	statusController: ReturnType<typeof createUsageStatusController>,
	rest: string,
): Promise<void> {
	const target = await chooseResetTarget(ctx, rest);
	if (!target) return;

	if (target === "all" && ctx.hasUI) {
		const confirmed = await ctx.ui.confirm(
			"Reset MultiCodex state",
			"Clear manual account override and all quota cooldown markers?",
		);
		if (!confirmed) return;
	}

	const hadManual = accountManager.hasManualAccount();
	if (target === "manual" || target === "all") {
		accountManager.clearManualAccount();
	}

	let clearedQuota = 0;
	if (target === "quota" || target === "all") {
		clearedQuota = accountManager.clearAllQuotaExhaustion();
	}

	const manualCleared = hadManual && !accountManager.hasManualAccount();
	ctx.ui.notify(
		`reset: target=${target} manualCleared=${manualCleared ? "yes" : "no"} quotaCleared=${clearedQuota}`,
		"info",
	);
	await statusController.refreshFor(ctx);
}

function runHelpSubcommand(ctx: ExtensionCommandContext): void {
	ctx.ui.notify(HELP_TEXT, "info");
}

async function runUseSubcommand(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	accountManager: AccountManager,
	statusController: ReturnType<typeof createUsageStatusController>,
	rest: string,
): Promise<void> {
	await accountManager.syncImportedOpenAICodexAuth();

	if (rest) {
		await useOrLoginAccount(pi, ctx, accountManager, rest);
		await statusController.refreshFor(ctx);
		return;
	}

	if (!ctx.hasUI) {
		ctx.ui.notify(
			"/multicodex use requires an identifier in non-interactive mode.",
			"warning",
		);
		return;
	}

	await openAccountSelectionFlow(ctx, accountManager, statusController);
}

async function runSubcommand(
	subcommand: Subcommand,
	rest: string,
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	accountManager: AccountManager,
	statusController: ReturnType<typeof createUsageStatusController>,
): Promise<void> {
	if (subcommand === "show") {
		await runShowSubcommand(ctx, accountManager);
		return;
	}
	if (subcommand === "use") {
		await runUseSubcommand(pi, ctx, accountManager, statusController, rest);
		return;
	}
	if (subcommand === "footer") {
		await runFooterSubcommand(ctx, statusController);
		return;
	}
	if (subcommand === "rotation") {
		await runRotationSubcommand(ctx);
		return;
	}
	if (subcommand === "verify") {
		await runVerifySubcommand(ctx, accountManager, statusController);
		return;
	}
	if (subcommand === "path") {
		await runPathSubcommand(ctx);
		return;
	}
	if (subcommand === "reset") {
		await runResetSubcommand(ctx, accountManager, statusController, rest);
		return;
	}

	runHelpSubcommand(ctx);
}

async function openMainPanel(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	accountManager: AccountManager,
	statusController: ReturnType<typeof createUsageStatusController>,
): Promise<void> {
	const actions = [
		"use: select, activate, or remove managed account",
		"show: managed account and usage summary",
		"footer: footer settings panel",
		"rotation: current rotation behavior",
		"verify: runtime health checks",
		"path: storage and settings locations",
		"reset: clear manual or quota state",
		"help: command usage",
	];

	const selected = await ctx.ui.select("MultiCodex", actions);
	if (!selected) return;

	const subcommandText = selected.split(":")[0]?.trim() ?? "";
	if (!isSubcommand(subcommandText)) {
		ctx.ui.notify(`Unknown subcommand: ${subcommandText}`, "warning");
		return;
	}
	await runSubcommand(
		subcommandText,
		"",
		pi,
		ctx,
		accountManager,
		statusController,
	);
}

export function registerCommands(
	pi: ExtensionAPI,
	accountManager: AccountManager,
	statusController: ReturnType<typeof createUsageStatusController>,
): void {
	pi.registerCommand("multicodex", {
		description: "Manage MultiCodex accounts, rotation, and footer settings",
		getArgumentCompletions: (argumentPrefix: string) =>
			getCommandCompletions(argumentPrefix, accountManager),
		handler: async (
			args: string,
			ctx: ExtensionCommandContext,
		): Promise<void> => {
			const parsed = parseCommandArgs(args);
			if (!parsed.subcommand) {
				if (!ctx.hasUI) {
					ctx.ui.notify(
						"/multicodex requires a subcommand in non-interactive mode. Use /multicodex help.",
						"warning",
					);
					return;
				}
				await openMainPanel(pi, ctx, accountManager, statusController);
				return;
			}

			if (!isSubcommand(parsed.subcommand)) {
				ctx.ui.notify(`Unknown subcommand: ${parsed.subcommand}`, "warning");
				runHelpSubcommand(ctx);
				return;
			}

			await runSubcommand(
				parsed.subcommand,
				parsed.rest,
				pi,
				ctx,
				accountManager,
				statusController,
			);
		},
	});
}
