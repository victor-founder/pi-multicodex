import type { AccountManager } from "./account-manager";

type WarningHandler = (message: string) => void;

async function refreshAndActivateBestAccount(
	accountManager: AccountManager,
	warningHandler?: WarningHandler,
): Promise<void> {
	accountManager.beginInitialization();
	try {
		await accountManager.loadPiAuth();
		await accountManager.refreshUsageForAllAccounts({ force: true });

		const needsReauth = accountManager.getAccountsNeedingReauth();
		if (needsReauth.length > 0) {
			const hints = needsReauth.map((a) => {
				const cmd = accountManager.isPiAuthAccount(a)
					? "/login openai-codex"
					: `/multicodex use ${a.email}`;
				return `${a.email} (${cmd})`;
			});
			warningHandler?.(
				`Multicodex: ${needsReauth.length} account(s) need re-authentication: ${hints.join(", ")}`,
			);
		}

		const manual = accountManager.getAvailableManualAccount();
		if (manual) return;
		if (accountManager.hasManualAccount()) {
			accountManager.clearManualAccount();
		}
		await accountManager.activateBestAccount();
	} finally {
		accountManager.markReady();
	}
}

export function handleSessionStart(
	accountManager: AccountManager,
	warningHandler?: WarningHandler,
): void {
	if (accountManager.getAccounts().length === 0) return;
	refreshAndActivateBestAccount(accountManager, warningHandler).catch(() => {});
}

export function handleNewSessionSwitch(
	accountManager: AccountManager,
	warningHandler?: WarningHandler,
): void {
	refreshAndActivateBestAccount(accountManager, warningHandler).catch(() => {});
}
