import { loginOpenAICodex } from "@mariozechner/pi-ai/oauth";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
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

export function registerCommands(
	pi: ExtensionAPI,
	accountManager: AccountManager,
	statusController: ReturnType<typeof createUsageStatusController>,
): void {
	pi.registerCommand("multicodex-login", {
		description: "Compatibility alias for /multicodex-use <identifier>",
		handler: async (
			args: string,
			ctx: ExtensionCommandContext,
		): Promise<void> => {
			const identifier = args.trim();
			if (!identifier) {
				ctx.ui.notify(
					"Please provide an email/identifier: /multicodex-use my@email.com",
					"error",
				);
				return;
			}

			await useOrLoginAccount(pi, ctx, accountManager, identifier);
			await statusController.refreshFor(ctx);
		},
	});

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
			const accounts = accountManager.getAccounts();
			if (accounts.length === 0) {
				ctx.ui.notify(
					"No managed accounts found. Use /login or /multicodex-use <identifier> first.",
					"warning",
				);
				return;
			}

			const options = accounts.map(
				(account) =>
					account.email +
					(account.quotaExhaustedUntil &&
					account.quotaExhaustedUntil > Date.now()
						? " (Quota)"
						: ""),
			);
			const selected = await ctx.ui.select("Select Account", options);
			if (!selected) return;

			const email = selected.split(" (")[0] ?? selected;
			accountManager.setManualAccount(email);
			ctx.ui.notify(`Now using ${email}`, "info");
			await statusController.refreshFor(ctx);
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
