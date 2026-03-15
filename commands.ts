import { loginOpenAICodex } from "@mariozechner/pi-ai/oauth";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import { getSelectListTheme } from "@mariozechner/pi-coding-agent";
import {
	Container,
	Key,
	matchesKey,
	SelectList,
	Text,
} from "@mariozechner/pi-tui";
import type { AccountManager } from "./account-manager";
import { openLoginInBrowser } from "./browser";
import type { createUsageStatusController } from "./status";
import { formatResetAt, isUsageUntouched } from "./usage";

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return typeof error === "string" ? error : JSON.stringify(error);
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
		ctx.ui.notify(`Login failed: ${getErrorMessage(error)}`, "error");
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

type AccountPanelResult =
	| { action: "select"; email: string }
	| { action: "remove"; email: string }
	| undefined;

function getAccountLabel(email: string, quotaExhaustedUntil?: number): string {
	if (!quotaExhaustedUntil || quotaExhaustedUntil <= Date.now()) {
		return email;
	}
	return `${email} (Quota)`;
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
			ctx.ui.notify(
				"No managed accounts found. Use /login or /multicodex-use <identifier> first.",
				"warning",
			);
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

export function registerCommands(
	pi: ExtensionAPI,
	accountManager: AccountManager,
	statusController: ReturnType<typeof createUsageStatusController>,
): void {
	pi.registerCommand("multicodex-use", {
		description:
			"Use an existing Codex account, or log in when the identifier is missing",
		handler: async (
			args: string,
			ctx: ExtensionCommandContext,
		): Promise<void> => {
			const identifier = args.trim();
			if (identifier) {
				await useOrLoginAccount(pi, ctx, accountManager, identifier);
				await statusController.refreshFor(ctx);
				return;
			}

			await accountManager.syncImportedOpenAICodexAuth();
			await openAccountSelectionFlow(ctx, accountManager, statusController);
		},
	});

	pi.registerCommand("multicodex-status", {
		description: "Show all Codex accounts and active status",
		handler: async (
			_args: string,
			ctx: ExtensionCommandContext,
		): Promise<void> => {
			await accountManager.syncImportedOpenAICodexAuth();
			await accountManager.refreshUsageForAllAccounts();
			const accounts = accountManager.getAccounts();
			if (accounts.length === 0) {
				ctx.ui.notify(
					"No managed accounts found. Use /login or /multicodex-use <identifier> first.",
					"warning",
				);
				return;
			}

			const active = accountManager.getActiveAccount();
			const options = accounts.map((account) => {
				const usage = accountManager.getCachedUsage(account.email);
				const isActive = active?.email === account.email;
				const quotaHit =
					account.quotaExhaustedUntil &&
					account.quotaExhaustedUntil > Date.now();
				const untouched = isUsageUntouched(usage) ? "untouched" : null;
				const imported = account.importSource ? "imported" : null;
				const tags = [
					isActive ? "active" : null,
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
					secondaryUsed === undefined
						? "unknown"
						: `${Math.round(secondaryUsed)}%`;
				const usageSummary = `5h ${primaryLabel} reset:${formatResetAt(primaryReset)} | weekly ${secondaryLabel} reset:${formatResetAt(secondaryReset)}`;
				return `${isActive ? "•" : " "} ${account.email}${suffix} - ${usageSummary}`;
			});

			await ctx.ui.select("MultiCodex Accounts", options);
		},
	});

	pi.registerCommand("multicodex-footer", {
		description: "Configure the MultiCodex usage footer",
		handler: async (
			_args: string,
			ctx: ExtensionCommandContext,
		): Promise<void> => {
			await statusController.openPreferencesPanel(ctx);
		},
	});
}
