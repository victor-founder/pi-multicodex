import type { AccountManager } from "./account-manager";

async function refreshAndActivateBestAccount(
	accountManager: AccountManager,
): Promise<void> {
	await accountManager.syncImportedOpenAICodexAuth();
	await accountManager.refreshUsageForAllAccounts({ force: true });
	const manual = accountManager.getAvailableManualAccount();
	if (manual) return;
	if (accountManager.hasManualAccount()) {
		accountManager.clearManualAccount();
	}
	await accountManager.activateBestAccount();
}

export function handleSessionStart(accountManager: AccountManager): void {
	if (accountManager.getAccounts().length === 0) return;
	void refreshAndActivateBestAccount(accountManager);
}

export function handleNewSessionSwitch(accountManager: AccountManager): void {
	void refreshAndActivateBestAccount(accountManager);
}
