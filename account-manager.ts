import {
	type OAuthCredentials,
	refreshOpenAICodexToken,
} from "@mariozechner/pi-ai/oauth";
import { AuthStorage } from "@mariozechner/pi-coding-agent";
import { normalizeUnknownError } from "pi-provider-utils/streams";
import {
	loadImportedOpenAICodexAuth,
	writeActiveTokenToAuthJson,
} from "./auth";
import { isAccountAvailable, pickBestAccount } from "./selection";
import {
	type Account,
	loadStorage,
	type StorageData,
	saveStorage,
} from "./storage";
import { type CodexUsageSnapshot, getNextResetAt } from "./usage";
import { fetchCodexUsage } from "./usage-client";

const USAGE_CACHE_TTL_MS = 5 * 60 * 1000;
const USAGE_REQUEST_TIMEOUT_MS = 10 * 1000;
const QUOTA_COOLDOWN_MS = 60 * 60 * 1000;

type WarningHandler = (message: string) => void;
type StateChangeHandler = () => void;

export class AccountManager {
	private data: StorageData;
	private usageCache = new Map<string, CodexUsageSnapshot>();
	private refreshPromises = new Map<string, Promise<string>>();
	private warningHandler?: WarningHandler;
	private manualEmail?: string;
	private stateChangeHandlers = new Set<StateChangeHandler>();
	private warnedAuthFailureEmails = new Set<string>();

	constructor() {
		this.data = loadStorage();
	}

	private save(): void {
		saveStorage(this.data);
	}

	private notifyStateChanged(): void {
		for (const handler of this.stateChangeHandlers) {
			handler();
		}
	}

	/**
	 * Write the active account's tokens to auth.json so pi's background features
	 * (rename, compaction) can resolve a valid API key via AuthStorage.
	 */
	private syncActiveTokenToAuthJson(account: Account): void {
		try {
			writeActiveTokenToAuthJson({
				access: account.accessToken,
				refresh: account.refreshToken,
				expires: account.expiresAt,
				accountId: account.accountId,
			});
		} catch {
			// Best-effort sync — do not block token resolution.
		}
	}

	onStateChange(handler: StateChangeHandler): () => void {
		this.stateChangeHandlers.add(handler);
		return () => {
			this.stateChangeHandlers.delete(handler);
		};
	}

	getAccounts(): Account[] {
		return this.data.accounts;
	}

	getAccount(email: string): Account | undefined {
		return this.data.accounts.find((a) => a.email === email);
	}

	setWarningHandler(handler?: WarningHandler): void {
		this.warningHandler = handler;
	}

	resetSessionWarnings(): void {
		this.warnedAuthFailureEmails.clear();
	}

	notifyRotationSkipForAuthFailure(account: Account, error: unknown): void {
		if (this.warnedAuthFailureEmails.has(account.email)) {
			return;
		}
		this.warnedAuthFailureEmails.add(account.email);
		const hint = account.importSource
			? "/multicodex reauth"
			: `/multicodex reauth ${account.email}`;
		this.warningHandler?.(
			`Multicodex skipped ${account.email} during rotation: ${normalizeUnknownError(error)}. Account is flagged in /multicodex accounts. Run ${hint} to repair it.`,
		);
	}

	private updateAccountEmail(account: Account, email: string): boolean {
		if (account.email === email) return false;
		const previousEmail = account.email;
		account.email = email;
		if (this.data.activeEmail === previousEmail) {
			this.data.activeEmail = email;
		}
		if (this.manualEmail === previousEmail) {
			this.manualEmail = email;
		}
		const cached = this.usageCache.get(previousEmail);
		if (cached) {
			this.usageCache.delete(previousEmail);
			this.usageCache.set(email, cached);
		}
		return true;
	}

	private removeAccountRecord(account: Account): boolean {
		const index = this.data.accounts.findIndex(
			(candidate) => candidate.email === account.email,
		);
		if (index < 0) return false;
		const removedEmail = this.data.accounts[index]?.email;
		this.data.accounts.splice(index, 1);
		if (removedEmail) {
			this.usageCache.delete(removedEmail);
			if (this.manualEmail === removedEmail) {
				this.manualEmail = undefined;
			}
			if (this.data.activeEmail === removedEmail) {
				this.data.activeEmail = this.data.accounts[0]?.email;
			}
		}
		return true;
	}

	private findAccountByRefreshToken(
		refreshToken: string,
		excludeEmail?: string,
	): Account | undefined {
		return this.data.accounts.find(
			(account) =>
				account.refreshToken === refreshToken && account.email !== excludeEmail,
		);
	}

	private applyCredentials(
		account: Account,
		creds: OAuthCredentials,
		options?: {
			importSource?: "pi-openai-codex";
			importMode?: "linked" | "synthetic";
			importFingerprint?: string;
		},
	): boolean {
		const accountId =
			typeof creds.accountId === "string" ? creds.accountId : undefined;
		let changed = false;
		if (account.accessToken !== creds.access) {
			account.accessToken = creds.access;
			changed = true;
		}
		if (account.refreshToken !== creds.refresh) {
			account.refreshToken = creds.refresh;
			changed = true;
		}
		if (account.expiresAt !== creds.expires) {
			account.expiresAt = creds.expires;
			changed = true;
		}
		if (accountId && account.accountId !== accountId) {
			account.accountId = accountId;
			changed = true;
		}
		if (
			options?.importSource &&
			account.importSource !== options.importSource
		) {
			account.importSource = options.importSource;
			changed = true;
		}
		if (options?.importMode && account.importMode !== options.importMode) {
			account.importMode = options.importMode;
			changed = true;
		}
		if (
			options?.importFingerprint &&
			account.importFingerprint !== options.importFingerprint
		) {
			account.importFingerprint = options.importFingerprint;
			changed = true;
		}
		if (account.needsReauth) {
			account.needsReauth = undefined;
			this.warnedAuthFailureEmails.delete(account.email);
			changed = true;
		}
		return changed;
	}

	addOrUpdateAccount(
		email: string,
		creds: OAuthCredentials,
		options?: {
			importSource?: "pi-openai-codex";
			importMode?: "linked" | "synthetic";
			importFingerprint?: string;
			preserveActive?: boolean;
		},
	): Account {
		const existing = this.getAccount(email);
		const duplicate = existing
			? undefined
			: this.findAccountByRefreshToken(creds.refresh);
		let target = existing ?? duplicate;
		let changed = false;

		if (target) {
			if (
				duplicate?.importSource === "pi-openai-codex" &&
				duplicate.email !== email &&
				!this.getAccount(email)
			) {
				changed = this.updateAccountEmail(duplicate, email) || changed;
			}
			changed =
				this.applyCredentials(target, creds, {
					...options,
					importMode:
						options?.importMode ??
						(duplicate?.importMode === "synthetic" ? "linked" : undefined),
				}) || changed;
		} else {
			target = {
				email,
				accessToken: creds.access,
				refreshToken: creds.refresh,
				expiresAt: creds.expires,
				accountId:
					typeof creds.accountId === "string" ? creds.accountId : undefined,
				importSource: options?.importSource,
				importMode: options?.importMode,
				importFingerprint: options?.importFingerprint,
			};
			this.data.accounts.push(target);
			changed = true;
		}

		if (!options?.preserveActive) {
			if (this.data.activeEmail !== target.email) {
				this.setActiveAccount(target.email);
				return target;
			}
		}

		if (changed) {
			this.save();
			this.notifyStateChanged();
		}
		return target;
	}

	getActiveAccount(): Account | undefined {
		const manual = this.getManualAccount();
		if (manual) return manual;
		if (this.data.activeEmail) {
			return this.getAccount(this.data.activeEmail);
		}
		return this.data.accounts[0];
	}

	getManualAccount(): Account | undefined {
		if (!this.manualEmail) return undefined;
		const account = this.getAccount(this.manualEmail);
		if (!account) {
			this.manualEmail = undefined;
			return undefined;
		}
		return account;
	}

	hasManualAccount(): boolean {
		return Boolean(this.manualEmail);
	}

	setActiveAccount(email: string): void {
		this.data.activeEmail = email;
		this.save();
		this.notifyStateChanged();
	}

	setManualAccount(email: string): void {
		const account = this.getAccount(email);
		if (!account) return;
		this.manualEmail = email;
		account.lastUsed = Date.now();
		this.notifyStateChanged();
	}

	clearManualAccount(): void {
		if (!this.manualEmail) return;
		this.manualEmail = undefined;
		this.notifyStateChanged();
	}

	getImportedAccount(): Account | undefined {
		return this.data.accounts.find(
			(account) => account.importSource === "pi-openai-codex",
		);
	}

	private clearImportedLink(account: Account): boolean {
		let changed = false;
		if (account.importSource) {
			account.importSource = undefined;
			changed = true;
		}
		if (account.importMode) {
			account.importMode = undefined;
			changed = true;
		}
		if (account.importFingerprint) {
			account.importFingerprint = undefined;
			changed = true;
		}
		return changed;
	}

	async syncImportedOpenAICodexAuth(): Promise<boolean> {
		const imported = await loadImportedOpenAICodexAuth();
		if (!imported) return false;

		const existingImported = this.getImportedAccount();
		if (existingImported?.importFingerprint === imported.fingerprint) {
			return false;
		}

		const matchingAccount = this.findAccountByRefreshToken(
			imported.credentials.refresh,
			existingImported?.email,
		);
		if (matchingAccount) {
			let changed = this.applyCredentials(
				matchingAccount,
				imported.credentials,
				{
					importSource: "pi-openai-codex",
					importMode: "linked",
					importFingerprint: imported.fingerprint,
				},
			);
			if (existingImported && existingImported !== matchingAccount) {
				if (existingImported.importMode === "synthetic") {
					changed = this.removeAccountRecord(existingImported) || changed;
				} else {
					changed = this.clearImportedLink(existingImported) || changed;
				}
			}
			if (changed) {
				this.save();
				this.notifyStateChanged();
			}
			return changed;
		}

		if (existingImported?.importMode === "synthetic") {
			const target = this.getAccount(imported.identifier);
			let changed = false;
			if (!target && existingImported.email !== imported.identifier) {
				changed = this.updateAccountEmail(
					existingImported,
					imported.identifier,
				);
			}
			changed =
				this.applyCredentials(existingImported, imported.credentials, {
					importSource: "pi-openai-codex",
					importMode: "synthetic",
					importFingerprint: imported.fingerprint,
				}) || changed;
			if (changed) {
				this.save();
				this.notifyStateChanged();
			}
			return changed;
		}

		if (existingImported) {
			const changed = this.clearImportedLink(existingImported);
			if (changed) {
				this.save();
				this.notifyStateChanged();
			}
		}

		this.addOrUpdateAccount(imported.identifier, imported.credentials, {
			importSource: "pi-openai-codex",
			importMode: "synthetic",
			importFingerprint: imported.fingerprint,
			preserveActive: true,
		});
		return true;
	}

	getAvailableManualAccount(options?: {
		excludeEmails?: Set<string>;
		now?: number;
	}): Account | undefined {
		const manual = this.getManualAccount();
		if (!manual) return undefined;
		const now = options?.now ?? Date.now();
		if (!isAccountAvailable(manual, now)) return undefined;
		if (options?.excludeEmails?.has(manual.email)) return undefined;
		return manual;
	}

	markExhausted(email: string, until: number): void {
		const account = this.getAccount(email);
		if (account) {
			account.quotaExhaustedUntil = until;
			this.save();
			this.notifyStateChanged();
		}
	}

	clearAllQuotaExhaustion(): number {
		let cleared = 0;
		for (const account of this.data.accounts) {
			if (account.quotaExhaustedUntil) {
				account.quotaExhaustedUntil = undefined;
				cleared += 1;
			}
		}
		if (cleared > 0) {
			this.save();
			this.notifyStateChanged();
		}
		return cleared;
	}

	removeAccount(email: string): boolean {
		const account = this.getAccount(email);
		if (!account) return false;
		const removed = this.removeAccountRecord(account);
		if (!removed) return false;
		this.save();
		this.notifyStateChanged();
		return true;
	}

	getCachedUsage(email: string): CodexUsageSnapshot | undefined {
		return this.usageCache.get(email);
	}

	getAccountsNeedingReauth(): Account[] {
		return this.data.accounts.filter((a) => a.needsReauth);
	}

	private markNeedsReauth(account: Account): void {
		account.needsReauth = true;
		this.save();
		this.notifyStateChanged();
	}

	async refreshUsageForAccount(
		account: Account,
		options?: { force?: boolean; signal?: AbortSignal },
	): Promise<CodexUsageSnapshot | undefined> {
		if (account.needsReauth) return this.usageCache.get(account.email);

		const cached = this.usageCache.get(account.email);
		const now = Date.now();
		if (
			cached &&
			!options?.force &&
			now - cached.fetchedAt < USAGE_CACHE_TTL_MS
		) {
			return cached;
		}

		try {
			const token = await this.ensureValidToken(account);
			const usage = await fetchCodexUsage(token, account.accountId, {
				signal: options?.signal,
				timeoutMs: USAGE_REQUEST_TIMEOUT_MS,
			});
			this.usageCache.set(account.email, usage);
			this.notifyStateChanged();
			return usage;
		} catch (error) {
			this.warningHandler?.(
				`Multicodex: failed to fetch usage for ${account.email}: ${normalizeUnknownError(
					error,
				)}`,
			);
			return undefined;
		}
	}

	async refreshUsageForAllAccounts(options?: {
		force?: boolean;
		signal?: AbortSignal;
	}): Promise<void> {
		const accounts = this.getAccounts();
		await Promise.all(
			accounts.map((account) => this.refreshUsageForAccount(account, options)),
		);
	}

	async refreshUsageIfStale(
		accounts: Account[],
		options?: { signal?: AbortSignal },
	): Promise<void> {
		const now = Date.now();
		const stale = accounts.filter((account) => {
			const cached = this.usageCache.get(account.email);
			return !cached || now - cached.fetchedAt >= USAGE_CACHE_TTL_MS;
		});
		if (stale.length === 0) return;
		await Promise.all(
			stale.map((account) =>
				this.refreshUsageForAccount(account, { force: true, ...options }),
			),
		);
	}

	async activateBestAccount(options?: {
		excludeEmails?: Set<string>;
		signal?: AbortSignal;
	}): Promise<Account | undefined> {
		const now = Date.now();
		this.clearExpiredExhaustion(now);
		const accounts = this.data.accounts;
		await this.refreshUsageIfStale(accounts, options);

		const selected = pickBestAccount(accounts, this.usageCache, {
			excludeEmails: options?.excludeEmails,
			now,
		});
		if (selected) {
			this.setActiveAccount(selected.email);
		}
		return selected;
	}

	async handleQuotaExceeded(
		account: Account,
		options?: { signal?: AbortSignal },
	): Promise<void> {
		const usage = await this.refreshUsageForAccount(account, {
			force: true,
			signal: options?.signal,
		});
		const now = Date.now();
		const resetAt = getNextResetAt(usage);
		const fallback = now + QUOTA_COOLDOWN_MS;
		const until = resetAt && resetAt > now ? resetAt : fallback;
		this.markExhausted(account.email, until);
	}

	private clearExpiredExhaustion(now: number): void {
		let changed = false;
		for (const account of this.data.accounts) {
			if (account.quotaExhaustedUntil && account.quotaExhaustedUntil <= now) {
				account.quotaExhaustedUntil = undefined;
				changed = true;
			}
		}
		if (changed) {
			this.save();
			this.notifyStateChanged();
		}
	}

	async ensureValidToken(account: Account): Promise<string> {
		if (account.needsReauth) {
			const hint = account.importSource
				? "/login openai-codex"
				: `/multicodex use ${account.email}`;
			throw new Error(
				`${account.email}: re-authentication required — run ${hint}`,
			);
		}

		if (Date.now() < account.expiresAt - 5 * 60 * 1000) {
			this.syncActiveTokenToAuthJson(account);
			return account.accessToken;
		}

		// For the imported pi account, delegate to AuthStorage so we share pi's
		// file lock and never race with pi's own refresh path.
		if (account.importSource === "pi-openai-codex") {
			return this.ensureValidTokenForImportedAccount(account);
		}

		const inflight = this.refreshPromises.get(account.email);
		if (inflight) {
			return inflight;
		}

		const promise = (async () => {
			try {
				const result = await refreshOpenAICodexToken(account.refreshToken);
				account.accessToken = result.access;
				account.refreshToken = result.refresh;
				account.expiresAt = result.expires;
				const accountId =
					typeof result.accountId === "string" ? result.accountId : undefined;
				if (accountId) {
					account.accountId = accountId;
				}
				this.save();
				this.notifyStateChanged();
				this.syncActiveTokenToAuthJson(account);
				return account.accessToken;
			} catch (error) {
				this.markNeedsReauth(account);
				throw error;
			} finally {
				this.refreshPromises.delete(account.email);
			}
		})();

		this.refreshPromises.set(account.email, promise);
		return promise;
	}

	/**
	 * Refresh path for the imported pi account.
	 *
	 * Uses AuthStorage so our refresh is serialised by the same file lock that
	 * pi's own credential refresh uses. This prevents "refresh_token_reused"
	 * errors caused by pi and multicodex both refreshing the same token
	 * simultaneously.
	 */
	private async ensureValidTokenForImportedAccount(
		account: Account,
	): Promise<string> {
		// Check if pi already refreshed since our last sync.
		const latest = await loadImportedOpenAICodexAuth();
		if (latest && Date.now() < latest.credentials.expires - 5 * 60 * 1000) {
			account.accessToken = latest.credentials.access;
			account.refreshToken = latest.credentials.refresh;
			account.expiresAt = latest.credentials.expires;
			account.importFingerprint = latest.fingerprint;
			const accountId =
				typeof latest.credentials.accountId === "string"
					? latest.credentials.accountId
					: undefined;
			if (accountId) {
				account.accountId = accountId;
			}
			this.save();
			this.notifyStateChanged();
			return account.accessToken;
		}

		// Both our copy and auth.json are expired — let AuthStorage refresh with
		// its file lock so only one caller (us or pi) fires the API call.
		let apiKey: string | undefined;
		try {
			const authStorage = AuthStorage.create();
			apiKey = await authStorage.getApiKey("openai-codex");
		} catch {
			// AuthStorage refresh failed; mark for re-auth below.
		}
		if (!apiKey) {
			this.markNeedsReauth(account);
			throw new Error(
				`${account.email}: token refresh failed — run /login openai-codex to re-authenticate`,
			);
		}

		// Read the refreshed tokens back from auth.json.
		const refreshed = await loadImportedOpenAICodexAuth();
		if (refreshed) {
			account.accessToken = refreshed.credentials.access;
			account.refreshToken = refreshed.credentials.refresh;
			account.expiresAt = refreshed.credentials.expires;
			account.importFingerprint = refreshed.fingerprint;
			const accountId =
				typeof refreshed.credentials.accountId === "string"
					? refreshed.credentials.accountId
					: undefined;
			if (accountId) {
				account.accountId = accountId;
			}
			this.save();
			this.notifyStateChanged();
		}

		return apiKey;
	}
}
