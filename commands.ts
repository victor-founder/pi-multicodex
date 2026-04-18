import { promises as fs, constants as fsConstants } from "node:fs";
import path from "node:path";
import { loginOpenAICodex } from "@mariozechner/pi-ai/oauth";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import { DynamicBorder, rawKeyHint } from "@mariozechner/pi-coding-agent";
import {
	type AutocompleteItem,
	Container,
	getKeybindings,
	matchesKey,
	Spacer,
	truncateToWidth,
	visibleWidth,
} from "@mariozechner/pi-tui";
import { getAgentSettingsPath } from "pi-provider-utils/agent-paths";
import { normalizeUnknownError } from "pi-provider-utils/streams";
import type { AccountManager } from "./account-manager";
import { openLoginInBrowser } from "./browser";
import {
	formatUsageSummaryText,
	loadFooterPreferences,
	type PercentDisplayMode,
	type createUsageStatusController,
} from "./status";
import { type Account, STORAGE_FILE } from "./storage";
import { isUsageUntouched } from "./usage";

const SETTINGS_FILE = getAgentSettingsPath();
const NO_ACCOUNTS_MESSAGE =
	"No managed accounts found. Open /multicodex accounts to add one.";
const HELP_TEXT =
	"Usage: /multicodex [accounts [identifier]|use [identifier]|show|refresh [identifier|all]|reauth [identifier]|footer|rotation|verify|path|reset [manual|quota|all]|help]";
const SUBCOMMANDS = [
	"accounts",
	"use",
	"show",
	"refresh",
	"reauth",
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
	| { action: "refresh"; email: string }
	| { action: "reauth"; email: string }
	| { action: "remove"; email: string }
	| { action: "add" }
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

function isPlaceholderAccount(account: Account): boolean {
	return (
		!account.accessToken || !account.refreshToken || account.expiresAt <= 0
	);
}

function getAccountTags(
	accountManager: AccountManager,
	account: Account,
): string[] {
	const usage = accountManager.getCachedUsage(account.email);
	const active = accountManager.getActiveAccount();
	const manual = accountManager.getManualAccount();
	const quotaHit =
		account.quotaExhaustedUntil && account.quotaExhaustedUntil > Date.now();
	return [
		active?.email === account.email ? "active" : null,
		manual?.email === account.email ? "manual" : null,
		accountManager.isPiAuthAccount(account) ? "pi auth" : null,
		account.needsReauth ? "needs reauth" : null,
		isPlaceholderAccount(account) ? "placeholder" : null,
		quotaHit ? "quota" : null,
		isUsageUntouched(usage) ? "untouched" : null,
	].filter((value): value is string => Boolean(value));
}

function formatUsageSummary(
	accountManager: AccountManager,
	account: Account,
	usageMode: PercentDisplayMode,
): string {
	return formatUsageSummaryText(
		accountManager.getCachedUsage(account.email),
		usageMode,
	);
}

function formatAccountStatusLine(
	accountManager: AccountManager,
	email: string,
	usageMode: PercentDisplayMode,
): string {
	const account = accountManager.getAccount(email);
	if (!account) return email;
	const tags = getAccountTags(accountManager, account).join(", ");
	const suffix = tags ? ` (${tags})` : "";
	return `${account.email}${suffix} - ${formatUsageSummary(accountManager, account, usageMode)}`;
}

async function loadUsageMode(): Promise<PercentDisplayMode> {
	try {
		return (await loadFooterPreferences()).usageMode;
	} catch {
		return "left";
	}
}

function getSubcommandCompletions(prefix: string): AutocompleteItem[] | null {
	const matches = SUBCOMMANDS.filter((value) => value.startsWith(prefix));
	return matches.length > 0 ? toAutocompleteItems(matches) : null;
}

function getAccountCompletions(
	subcommand: "accounts" | "use" | "reauth",
	prefix: string,
	accountManager: AccountManager,
): AutocompleteItem[] | null {
	const matches = accountManager
		.getAccounts()
		.map((account) => account.email)
		.filter((value) => value.startsWith(prefix));
	if (matches.length === 0) return null;
	return matches.map((value) => ({
		value: `${subcommand} ${value}`,
		label: value,
	}));
}

function getRefreshCompletions(
	prefix: string,
	accountManager: AccountManager,
): AutocompleteItem[] | null {
	const values = [
		"all",
		...accountManager.getAccounts().map((account) => account.email),
	].filter((value, index, array) => array.indexOf(value) === index);
	const matches = values.filter((value) => value.startsWith(prefix));
	if (matches.length === 0) return null;
	return matches.map((value) => ({
		value: `refresh ${value}`,
		label: value,
	}));
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

	if (subcommand === "accounts") {
		return getAccountCompletions("accounts", rest, accountManager);
	}
	if (subcommand === "use") {
		return getAccountCompletions("use", rest, accountManager);
	}
	if (subcommand === "reauth") {
		return getAccountCompletions("reauth", rest, accountManager);
	}
	if (subcommand === "refresh") {
		return getRefreshCompletions(rest, accountManager);
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
): Promise<string | undefined> {
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

		const account = accountManager.addOrUpdateAccount(identifier, creds);
		accountManager.setManualAccount(account.email);
		ctx.ui.notify(`Now using ${account.email}`, "info");
		return account.email;
	} catch (error) {
		ctx.ui.notify(`Login failed: ${normalizeUnknownError(error)}`, "error");
		return undefined;
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
			accountManager.setManualAccount(existing.email);
			ctx.ui.notify(`Now using ${existing.email}`, "info");
			return;
		} catch {
			ctx.ui.notify(
				`Stored auth for ${existing.email} is no longer valid. Starting login again.`,
				"warning",
			);
		}
	}

	await loginAndActivateAccount(pi, ctx, accountManager, identifier);
}

async function refreshSingleAccount(
	ctx: ExtensionCommandContext,
	accountManager: AccountManager,
	email: string,
	usageMode: PercentDisplayMode,
): Promise<void> {
	const account = accountManager.getAccount(email);
	if (!account) {
		ctx.ui.notify(`Unknown account: ${email}`, "warning");
		return;
	}

	try {
		await accountManager.ensureValidToken(account);
	} catch (error) {
		ctx.ui.notify(
			`refresh ${email}: ${normalizeUnknownError(error)}`,
			"warning",
		);
		return;
	}

	await accountManager.refreshUsageForAccount(account, { force: true });
	ctx.ui.notify(
		`refreshed ${formatAccountStatusLine(accountManager, email, usageMode)}`,
		"info",
	);
}

async function refreshAllAccounts(
	ctx: ExtensionCommandContext,
	accountManager: AccountManager,
): Promise<void> {
	await accountManager.refreshUsageForAllAccounts({ force: true });
	const accounts = accountManager.getAccounts();
	const needsReauth = accountManager.getAccountsNeedingReauth().length;
	const summary =
		accounts.length === 0
			? NO_ACCOUNTS_MESSAGE
			: `refreshed ${accounts.length} account(s); reauth needed=${needsReauth}`;
	ctx.ui.notify(summary, needsReauth > 0 ? "warning" : "info");
}

async function reauthenticateAccount(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	accountManager: AccountManager,
	email: string,
): Promise<void> {
	const account = accountManager.getAccount(email);
	if (!account) {
		ctx.ui.notify(`Unknown account: ${email}`, "warning");
		return;
	}
	await loginAndActivateAccount(pi, ctx, accountManager, account.email);
}

async function promptForNewAccountIdentifier(
	ctx: ExtensionCommandContext,
): Promise<string | undefined> {
	const identifier = (await ctx.ui.input("Account identifier"))?.trim();
	if (!identifier) {
		ctx.ui.notify("Account creation cancelled.", "warning");
		return undefined;
	}
	return identifier;
}

async function openAccountManagementPanel(
	ctx: ExtensionCommandContext,
	accountManager: AccountManager,
	usageMode: PercentDisplayMode,
): Promise<AccountPanelResult> {
	const accounts = accountManager.getAccounts();

	return ctx.ui.custom<AccountPanelResult>((tui, theme, _kb, done) => {
		const kb = getKeybindings();
		let selectedIndex = 0;
		const maxVisible = 12;

		function getSelectedAccount(): Account | undefined {
			return accounts[selectedIndex];
		}

		function findNextIndex(from: number, direction: number): number {
			if (accounts.length === 0) return 0;
			return Math.max(0, Math.min(accounts.length - 1, from + direction));
		}

		function renderTag(text: string): string {
			if (text === "active") {
				return theme.fg("accent", `[${text}]`);
			}
			if (text === "manual") {
				return theme.fg("warning", `[${text}]`);
			}
			if (text === "needs reauth") {
				return theme.fg("error", `[${text}]`);
			}
			if (text === "placeholder") {
				return theme.fg("warning", `[${text}]`);
			}
			if (text === "quota") {
				return theme.fg("warning", `[${text}]`);
			}
			if (text === "pi auth" || text === "pi auth only") {
				return theme.fg("success", `[${text}]`);
			}
			return theme.fg("muted", `[${text}]`);
		}

		function renderRow(
			account: Account,
			selected: boolean,
			width: number,
		): string[] {
			const cursor = selected ? theme.fg("accent", ">") : theme.fg("dim", " ");
			const name = selected ? theme.bold(account.email) : account.email;
			const tags = getAccountTags(accountManager, account)
				.map((tag) => renderTag(tag))
				.join(" ");
			const primary = truncateToWidth(
				`${cursor} ${name}${tags ? ` ${tags}` : ""}`,
				width,
				"",
			);
			const summaryColor = account.needsReauth
				? "warning"
				: isPlaceholderAccount(account)
					? "muted"
					: "dim";
			const secondary = theme.fg(
				summaryColor,
				formatUsageSummary(accountManager, account, usageMode),
			);
			return [primary, truncateToWidth(`  ${secondary}`, width, "")];
		}

		const header = {
			invalidate() {},
			render(width: number): string[] {
				const title = theme.bold("MultiCodex Accounts");
				const sep = theme.fg("muted", " · ");
				const hints = [
					rawKeyHint("enter", "use"),
					rawKeyHint("u", "refresh"),
					rawKeyHint("r", "reauth"),
					rawKeyHint("n", "add"),
					rawKeyHint("backspace", "remove"),
					rawKeyHint("esc", "close"),
				].join(sep);
				const spacing = Math.max(
					1,
					width - visibleWidth(title) - visibleWidth(hints),
				);
				const reauthCount = accountManager.getAccountsNeedingReauth().length;
				const placeholderCount = accounts.filter((account) =>
					isPlaceholderAccount(account),
				).length;
				const status = [
					`${accounts.length} account${accounts.length === 1 ? "" : "s"}`,
					reauthCount > 0 ? `${reauthCount} need reauth` : undefined,
					placeholderCount > 0
						? `${placeholderCount} placeholder${placeholderCount === 1 ? "" : "s"}`
						: undefined,
				]
					.filter(Boolean)
					.join(" · ");
				return [
					truncateToWidth(`${title}${" ".repeat(spacing)}${hints}`, width, ""),
					theme.fg("muted", status),
				];
			},
		};

		const list = {
			invalidate() {},
			render(width: number): string[] {
				const lines: string[] = [];
				if (accounts.length === 0) {
					return [theme.fg("muted", "  No managed accounts")];
				}

				const visibleRows = Math.max(1, Math.floor(maxVisible / 2));
				const startIndex = Math.max(
					0,
					Math.min(
						selectedIndex - Math.floor(visibleRows / 2),
						Math.max(0, accounts.length - visibleRows),
					),
				);
				const endIndex = Math.min(accounts.length, startIndex + visibleRows);

				for (let index = startIndex; index < endIndex; index++) {
					const account = accounts[index];
					if (!account) continue;
					lines.push(...renderRow(account, index === selectedIndex, width));
					if (index < endIndex - 1) {
						lines.push("");
					}
				}

				const selected = getSelectedAccount();
				if (selected) {
					lines.push("");
					const detail = isPlaceholderAccount(selected)
						? `selected: ${selected.email} · restored placeholder, re-auth required`
						: `selected: ${selected.email}`;
					lines.push(truncateToWidth(theme.fg("dim", detail), width, ""));
				}

				const current = selectedIndex + 1;
				lines.push(
					theme.fg(
						"dim",
						`  ${current}/${accounts.length} visible account rows`,
					),
				);
				return lines;
			},
		};

		const container = new Container();
		container.addChild(new Spacer(1));
		container.addChild(new DynamicBorder());
		container.addChild(new Spacer(1));
		container.addChild(header);
		container.addChild(new Spacer(1));
		container.addChild(list);
		container.addChild(new Spacer(1));
		container.addChild(new DynamicBorder());

		return {
			render(width: number) {
				return container.render(width);
			},
			invalidate() {
				container.invalidate();
			},
			handleInput(data: string) {
				if (kb.matches(data, "tui.select.up")) {
					selectedIndex = findNextIndex(selectedIndex, -1);
					tui.requestRender();
					return;
				}
				if (kb.matches(data, "tui.select.down")) {
					selectedIndex = findNextIndex(selectedIndex, 1);
					tui.requestRender();
					return;
				}
				if (kb.matches(data, "tui.select.pageUp")) {
					selectedIndex = findNextIndex(selectedIndex, -5);
					tui.requestRender();
					return;
				}
				if (kb.matches(data, "tui.select.pageDown")) {
					selectedIndex = findNextIndex(selectedIndex, 5);
					tui.requestRender();
					return;
				}
				if (
					kb.matches(data, "tui.select.cancel") ||
					matchesKey(data, "ctrl+c")
				) {
					done(undefined);
					return;
				}
				if (
					data === "\r" ||
					data === "\n" ||
					kb.matches(data, "tui.select.confirm")
				) {
					const selected = getSelectedAccount();
					if (selected) {
						done({ action: "select", email: selected.email });
					}
					return;
				}
				if (data.toLowerCase() === "n") {
					done({ action: "add" });
					return;
				}
				if (data.toLowerCase() === "u") {
					const selected = getSelectedAccount();
					if (selected) {
						done({ action: "refresh", email: selected.email });
					}
					return;
				}
				if (data.toLowerCase() === "r") {
					const selected = getSelectedAccount();
					if (selected) {
						done({ action: "reauth", email: selected.email });
					}
					return;
				}
				if (matchesKey(data, "backspace")) {
					const selected = getSelectedAccount();
					if (selected) {
						done({ action: "remove", email: selected.email });
					}
				}
			},
		};
	});
}

async function openAccountManagementFlow(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	accountManager: AccountManager,
	statusController: ReturnType<typeof createUsageStatusController>,
): Promise<void> {
	const usageMode = await loadUsageMode();
	while (true) {
		const accounts = accountManager.getAccounts();
		if (accounts.length === 0) {
			const identifier = await promptForNewAccountIdentifier(ctx);
			if (!identifier) return;
			await loginAndActivateAccount(pi, ctx, accountManager, identifier);
			await statusController.refreshFor(ctx);
			continue;
		}

		const result = await openAccountManagementPanel(ctx, accountManager, usageMode);
		if (!result) return;

		if (result.action === "add") {
			const identifier = await promptForNewAccountIdentifier(ctx);
			if (!identifier) continue;
			await loginAndActivateAccount(pi, ctx, accountManager, identifier);
			await statusController.refreshFor(ctx);
			continue;
		}

		if (result.action === "select") {
			await useOrLoginAccount(pi, ctx, accountManager, result.email);
			await statusController.refreshFor(ctx);
			return;
		}

		if (result.action === "refresh") {
			await refreshSingleAccount(ctx, accountManager, result.email, usageMode);
			await statusController.refreshFor(ctx);
			continue;
		}

		if (result.action === "reauth") {
			await reauthenticateAccount(pi, ctx, accountManager, result.email);
			await statusController.refreshFor(ctx);
			continue;
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

async function runAccountsSubcommand(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	accountManager: AccountManager,
	statusController: ReturnType<typeof createUsageStatusController>,
	rest: string,
): Promise<void> {
	await accountManager.refreshUsageForAllAccounts();

	if (rest) {
		await useOrLoginAccount(pi, ctx, accountManager, rest);
		await statusController.refreshFor(ctx);
		return;
	}

	const accounts = accountManager.getAccounts();
	if (accounts.length === 0) {
		if (!ctx.hasUI) {
			ctx.ui.notify(NO_ACCOUNTS_MESSAGE, "warning");
			return;
		}
		await openAccountManagementFlow(pi, ctx, accountManager, statusController);
		return;
	}

	if (!ctx.hasUI) {
		const usageMode = await loadUsageMode();
		const lines = accounts.map((account) =>
			formatAccountStatusLine(accountManager, account.email, usageMode),
		);
		ctx.ui.notify(lines.join("\n"), "info");
		return;
	}

	await openAccountManagementFlow(pi, ctx, accountManager, statusController);
}

async function runShowSubcommand(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	accountManager: AccountManager,
	statusController: ReturnType<typeof createUsageStatusController>,
): Promise<void> {
	await runAccountsSubcommand(pi, ctx, accountManager, statusController, "");
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
		"Current policy: manual account first, then untouched accounts, then earliest weekly reset, then random fallback.",
		"If token validation fails before a request starts, MultiCodex skips that account and retries another one.",
		"If a request hits quota or rate limit before any output streams, MultiCodex marks the account on cooldown and retries.",
		"If pi auth is active, it participates in rotation as an ephemeral account without being persisted.",
	];

	if (!ctx.hasUI) {
		ctx.ui.notify(lines.join(" "), "info");
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
	await statusController.loadPreferences(ctx);
	const hasPiAuth = accountManager
		.getAccounts()
		.some((a) => accountManager.isPiAuthAccount(a));
	const accounts = accountManager.getAccounts().length;
	const active = accountManager.getActiveAccount()?.email ?? "none";
	const needsReauth = accountManager.getAccountsNeedingReauth().length;
	const ok = storageWritable && settingsWritable && needsReauth === 0;

	if (!ctx.hasUI) {
		ctx.ui.notify(
			`verify: ${ok ? "PASS" : "WARN"} storage=${storageWritable ? "ok" : "fail"} settings=${settingsWritable ? "ok" : "fail"} accounts=${accounts} active=${active} piAuth=${hasPiAuth ? "loaded" : "none"} needsReauth=${needsReauth}`,
			ok ? "info" : "warning",
		);
		return;
	}

	const lines = [
		`storage directory writable: ${storageWritable ? "yes" : "no"}`,
		`settings directory writable: ${settingsWritable ? "yes" : "no"}`,
		`managed accounts: ${accounts}`,
		`active account: ${active}`,
		`pi auth (ephemeral): ${hasPiAuth ? "loaded" : "none"}`,
		`accounts needing re-authentication: ${needsReauth}`,
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

async function runRefreshSubcommand(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	accountManager: AccountManager,
	statusController: ReturnType<typeof createUsageStatusController>,
	rest: string,
): Promise<void> {
	if (!rest || rest === "all") {
		if (!ctx.hasUI || rest === "all") {
			await refreshAllAccounts(ctx, accountManager);
			await statusController.refreshFor(ctx);
			return;
		}
		await openAccountManagementFlow(pi, ctx, accountManager, statusController);
		return;
	}
	await refreshSingleAccount(
		ctx,
		accountManager,
		rest,
		await loadUsageMode(),
	);
	await statusController.refreshFor(ctx);
}

async function runReauthSubcommand(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	accountManager: AccountManager,
	statusController: ReturnType<typeof createUsageStatusController>,
	rest: string,
): Promise<void> {
	if (rest) {
		await reauthenticateAccount(pi, ctx, accountManager, rest);
		await statusController.refreshFor(ctx);
		return;
	}
	if (!ctx.hasUI) {
		const active = accountManager.getActiveAccount();
		if (!active) {
			ctx.ui.notify(NO_ACCOUNTS_MESSAGE, "warning");
			return;
		}
		await reauthenticateAccount(pi, ctx, accountManager, active.email);
		return;
	}
	await openAccountManagementFlow(pi, ctx, accountManager, statusController);
}

async function runSubcommand(
	subcommand: Subcommand,
	rest: string,
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	accountManager: AccountManager,
	statusController: ReturnType<typeof createUsageStatusController>,
): Promise<void> {
	if (subcommand === "accounts" || subcommand === "use") {
		await runAccountsSubcommand(
			pi,
			ctx,
			accountManager,
			statusController,
			rest,
		);
		return;
	}
	if (subcommand === "show") {
		await runShowSubcommand(pi, ctx, accountManager, statusController);
		return;
	}
	if (subcommand === "refresh") {
		await runRefreshSubcommand(pi, ctx, accountManager, statusController, rest);
		return;
	}
	if (subcommand === "reauth") {
		await runReauthSubcommand(pi, ctx, accountManager, statusController, rest);
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
		"accounts: inspect, select, refresh, re-authenticate, add, or remove managed account",
		"refresh: force a health and usage refresh",
		"reauth: re-authenticate an account",
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
		description:
			"Manage MultiCodex accounts, health, rotation, and footer settings",
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
