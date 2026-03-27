import {
	type OAuthCredentials,
	refreshOpenAICodexToken,
} from "@mariozechner/pi-ai/oauth";
import { normalizeUnknownError } from "@victor-software-house/pi-provider-utils/streams";
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
	private usageCache = new Map<string, CodexUsageSnapshot>();
	private refreshPromises = new Map<string, Promise<string>>();
	private warningHandler?: WarningHandler;
	private manualEmail?: string;
	private stateChangeHandlers = new Set<StateChangeHandler>();

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

	addOrUpdateAccount(
		email: string,
		creds: OAuthCredentials,
		options?: {
			importSource?: "pi-openai-codex";
			importFingerprint?: string;
		},
	): void {
		const existing = this.getAccount(email);
		const accountId =
			typeof creds.accountId === "string" ? creds.accountId : undefined;
		if (existing) {
			existing.accessToken = creds.access;
			existing.refreshToken = creds.refresh;
			existing.expiresAt = creds.expires;
			existing.importSource = options?.importSource;
			existing.importFingerprint = options?.importFingerprint;
			if (accountId) {
				existing.accountId = accountId;
			}
		} else {
			this.data.accounts.push({
				email,
				accessToken: creds.access,
				refreshToken: creds.refresh,
				expiresAt: creds.expires,
				accountId,
				importSource: options?.importSource,
				importFingerprint: options?.importFingerprint,
			});
		}
		this.setActiveAccount(email);
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

	async syncImportedOpenAICodexAuth(): Promise<boolean> {
		const imported = await loadImportedOpenAICodexAuth();
		if (!imported) return false;

		const existingImported = this.getImportedAccount();
		if (
			existingImported?.importFingerprint === imported.fingerprint &&
			existingImported.email === imported.identifier
		) {
			return false;
		}

		if (existingImported && existingImported.email !== imported.identifier) {
			const target = this.getAccount(imported.identifier);
			if (!target) {
				existingImported.email = imported.identifier;
			}
		}

		this.addOrUpdateAccount(imported.identifier, imported.credentials, {
			importSource: "pi-openai-codex",
			importFingerprint: imported.fingerprint,
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
		const index = this.data.accounts.findIndex(
			(account) => account.email === email,
		);
		if (index < 0) return false;

		this.data.accounts.splice(index, 1);
		this.usageCache.delete(email);
		if (this.manualEmail === email) {
			this.manualEmail = undefined;
		}
		if (this.data.activeEmail === email) {
			this.data.activeEmail = this.data.accounts[0]?.email;
		}
		this.save();
		this.notifyStateChanged();
		return true;
	}

	getCachedUsage(email: string): CodexUsageSnapshot | undefined {
		return this.usageCache.get(email);
	}

	async refreshUsageForAccount(
		account: Account,
		options?: { force?: boolean; signal?: AbortSignal },
	): Promise<CodexUsageSnapshot | undefined> {
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
		if (Date.now() < account.expiresAt - 5 * 60 * 1000) {
			return account.accessToken;
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
			} finally {
				this.refreshPromises.delete(account.email);
			}
		})();

		this.refreshPromises.set(account.email, promise);
		return promise;
	}
}
