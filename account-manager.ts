import {
	type OAuthCredentials,
	refreshOpenAICodexToken,
} from "@mariozechner/pi-ai/oauth";
import { normalizeUnknownError } from "pi-provider-utils/streams";
import { loadImportedOpenAICodexAuth } from "./auth";
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
	private piAuthAccount?: Account;
	private usageCache = new Map<string, CodexUsageSnapshot>();
	private refreshPromises = new Map<string, Promise<string>>();
	private warningHandler?: WarningHandler;
	private manualEmail?: string;
	private stateChangeHandlers = new Set<StateChangeHandler>();
	private warnedAuthFailureEmails = new Set<string>();
	private readyPromise: Promise<void> = Promise.resolve();
	private readyResolve?: () => void;

	constructor() {
		this.data = loadStorage();
	}

	/**
	 * Mark the account manager as initializing. The returned promise
	 * resolves when {@link markReady} is called. Stream requests wait
	 * on {@link waitUntilReady} so they don't race the startup refresh.
	 */
	beginInitialization(): void {
		this.readyPromise = new Promise<void>((resolve) => {
			this.readyResolve = resolve;
		});
	}

	markReady(): void {
		this.readyResolve?.();
		this.readyResolve = undefined;
	}

	waitUntilReady(): Promise<void> {
		return this.readyPromise;
	}

	private save(): void {
		saveStorage(this.data);
	}

	private notifyStateChanged(): void {
		for (const handler of this.stateChangeHandlers) {
			handler();
		}
	}

	onStateChange(handler: StateChangeHandler): () => void {
		this.stateChangeHandlers.add(handler);
		return () => {
			this.stateChangeHandlers.delete(handler);
		};
	}

	getAccounts(): Account[] {
		if (this.piAuthAccount) {
			return [...this.data.accounts, this.piAuthAccount];
		}
		return this.data.accounts;
	}

	getAccount(email: string): Account | undefined {
		if (this.piAuthAccount?.email === email) return this.piAuthAccount;
		return this.data.accounts.find((a) => a.email === email);
	}

	isPiAuthAccount(account: Account): boolean {
		return this.piAuthAccount !== undefined && account === this.piAuthAccount;
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
		const hint = this.isPiAuthAccount(account)
			? "/login openai-codex"
			: `/multicodex reauth ${account.email}`;
		this.warningHandler?.(
			`Multicodex skipped ${account.email} during rotation: ${normalizeUnknownError(error)}. Account is flagged in /multicodex accounts. Run ${hint} to repair it.`,
		);
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

	private applyCredentials(account: Account, creds: OAuthCredentials): boolean {
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
		if (account.needsReauth) {
			account.needsReauth = undefined;
			this.warnedAuthFailureEmails.delete(account.email);
			changed = true;
		}
		return changed;
	}

	addOrUpdateAccount(email: string, creds: OAuthCredentials): Account {
		const existing = this.data.accounts.find((a) => a.email === email);
		if (existing) {
			const changed = this.applyCredentials(existing, creds);
			if (changed) {
				this.save();
				this.notifyStateChanged();
			}
			return existing;
		}

		const account: Account = {
			email,
			accessToken: creds.access,
			refreshToken: creds.refresh,
			expiresAt: creds.expires,
			accountId:
				typeof creds.accountId === "string" ? creds.accountId : undefined,
		};
		this.data.accounts.push(account);
		this.setActiveAccount(email);
		return account;
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

	/**
	 * Read pi's openai-codex auth from auth.json and expose it as a
	 * memory-only ephemeral account. Never persists to codex-accounts.json.
	 * If the identity already exists as a managed account, skip it.
	 */
	async loadPiAuth(): Promise<void> {
		const imported = await loadImportedOpenAICodexAuth();
		if (!imported) {
			this.piAuthAccount = undefined;
			this.notifyStateChanged();
			return;
		}

		const alreadyManaged = this.data.accounts.find(
			(a) => a.email === imported.identifier,
		);

		if (alreadyManaged) {
			this.piAuthAccount = undefined;
			this.notifyStateChanged();
			return;
		}

		this.piAuthAccount = {
			email: imported.identifier,
			accessToken: imported.credentials.access,
			refreshToken: imported.credentials.refresh,
			expiresAt: imported.credentials.expires,
			accountId:
				typeof imported.credentials.accountId === "string"
					? imported.credentials.accountId
					: undefined,
		};
		this.notifyStateChanged();
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
			if (!this.isPiAuthAccount(account)) {
				this.save();
			}
			this.notifyStateChanged();
		}
	}

	clearAllQuotaExhaustion(): number {
		let cleared = 0;
		let managedChanged = false;
		for (const account of this.getAccounts()) {
			if (account.quotaExhaustedUntil) {
				account.quotaExhaustedUntil = undefined;
				cleared += 1;
				if (!this.isPiAuthAccount(account)) {
					managedChanged = true;
				}
			}
		}
		if (managedChanged) {
			this.save();
		}
		if (cleared > 0) {
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
		if (!this.isPiAuthAccount(account)) {
			this.save();
		}
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
		const accounts = this.getAccounts();
		await this.refreshUsageIfStale(accounts, options);

		const selected = pickBestAccount(accounts, this.usageCache, {
			excludeEmails: options?.excludeEmails,
			now,
		});
		if (selected) {
			if (this.isPiAuthAccount(selected)) {
				// Don't persist ephemeral pi auth email to disk — it would
				// become a stale activeEmail after restart.
				this.data.activeEmail = selected.email;
				this.notifyStateChanged();
			} else {
				this.setActiveAccount(selected.email);
			}
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
		let managedChanged = false;
		let anyChanged = false;
		for (const account of this.getAccounts()) {
			if (account.quotaExhaustedUntil && account.quotaExhaustedUntil <= now) {
				account.quotaExhaustedUntil = undefined;
				anyChanged = true;
				if (!this.isPiAuthAccount(account)) {
					managedChanged = true;
				}
			}
		}
		if (managedChanged) {
			this.save();
		}
		if (anyChanged) {
			this.notifyStateChanged();
		}
	}

	async ensureValidToken(account: Account): Promise<string> {
		if (account.needsReauth) {
			const hint = this.isPiAuthAccount(account)
				? "/login openai-codex"
				: `/multicodex use ${account.email}`;
			throw new Error(
				`${account.email}: re-authentication required — run ${hint}`,
			);
		}

		if (Date.now() < account.expiresAt - 5 * 60 * 1000) {
			return account.accessToken;
		}

		if (this.isPiAuthAccount(account)) {
			return this.ensureValidTokenForPiAuth(account);
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
	 * Read-only refresh for the ephemeral pi auth account.
	 * Re-reads auth.json for fresh tokens. Never writes anything.
	 */
	private async ensureValidTokenForPiAuth(account: Account): Promise<string> {
		const latest = await loadImportedOpenAICodexAuth();
		if (latest && Date.now() < latest.credentials.expires - 5 * 60 * 1000) {
			account.accessToken = latest.credentials.access;
			account.refreshToken = latest.credentials.refresh;
			account.expiresAt = latest.credentials.expires;
			const accountId =
				typeof latest.credentials.accountId === "string"
					? latest.credentials.accountId
					: undefined;
			if (accountId) {
				account.accountId = accountId;
			}
			this.notifyStateChanged();
			return account.accessToken;
		}

		this.piAuthAccount = undefined;
		this.notifyStateChanged();
		throw new Error(
			`${account.email}: pi auth expired — run /login openai-codex`,
		);
	}
}
