import type { Account } from "./storage";
import {
	type CodexUsageSnapshot,
	getMaxUsedPercent,
	getWeeklyResetAt,
	isUsageUntouched,
} from "./usage";

export function isAccountAvailable(account: Account, now: number): boolean {
	if (account.needsReauth) return false;
	return !account.quotaExhaustedUntil || account.quotaExhaustedUntil <= now;
}

function pickRandomAccount(accounts: Account[]): Account | undefined {
	if (accounts.length === 0) return undefined;
	return accounts[Math.floor(Math.random() * accounts.length)];
}

function pickLowestUsageAccount(
	accounts: Account[],
	usageByEmail: Map<string, CodexUsageSnapshot>,
): Account | undefined {
	const candidates = accounts
		.map((account) => {
			const usage = usageByEmail.get(account.email);
			return {
				account,
				usedPercent: getMaxUsedPercent(usage) ?? 100,
				resetAt: getWeeklyResetAt(usage) ?? Number.MAX_SAFE_INTEGER,
			};
		})
		.sort((a, b) => {
			// Primary: lowest usage first
			const usageDiff = a.usedPercent - b.usedPercent;
			if (usageDiff !== 0) return usageDiff;
			// Tiebreaker: earliest weekly reset first
			return a.resetAt - b.resetAt;
		});

	return candidates[0]?.account;
}

export function pickBestAccount(
	accounts: Account[],
	usageByEmail: Map<string, CodexUsageSnapshot>,
	options?: { excludeEmails?: Set<string>; now?: number },
): Account | undefined {
	const now = options?.now ?? Date.now();
	const available = accounts.filter(
		(account) =>
			isAccountAvailable(account, now) &&
			!options?.excludeEmails?.has(account.email),
	);
	if (available.length === 0) return undefined;

	const withUsage = available.filter((account) =>
		usageByEmail.has(account.email),
	);
	const untouched = withUsage.filter((account) =>
		isUsageUntouched(usageByEmail.get(account.email)),
	);

	if (untouched.length > 0) {
		return (
			pickLowestUsageAccount(untouched, usageByEmail) ??
			pickRandomAccount(untouched)
		);
	}

	const lowestUsage = pickLowestUsageAccount(withUsage, usageByEmail);
	if (lowestUsage) return lowestUsage;

	return pickRandomAccount(available);
}
