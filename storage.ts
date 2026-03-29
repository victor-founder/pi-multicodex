import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentPath } from "pi-provider-utils/agent-paths";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const CURRENT_VERSION = 1;

const SCHEMA_URL =
	"https://raw.githubusercontent.com/victor-software-house/pi-multicodex/main/schemas/codex-accounts.schema.json";

const AccountSchema = z
	.object({
		email: z.string().min(1).meta({ description: "Account email identifier" }),
		accessToken: z
			.string()
			.min(1)
			.meta({ description: "OAuth access token (JWT)" }),
		refreshToken: z
			.string()
			.min(1)
			.meta({ description: "OAuth refresh token" }),
		expiresAt: z
			.number()
			.meta({ description: "Token expiry timestamp (ms since epoch)" }),
		accountId: z.string().optional().meta({ description: "OpenAI account ID" }),
		lastUsed: z
			.number()
			.optional()
			.meta({ description: "Last manual selection timestamp (ms)" }),
		quotaExhaustedUntil: z
			.number()
			.optional()
			.meta({ description: "Quota cooldown expiry (ms)" }),
		needsReauth: z
			.boolean()
			.optional()
			.meta({ description: "Account needs re-authentication" }),
	})
	.meta({ id: "Account", description: "A managed OpenAI Codex account" });

export const StorageSchema = z
	.object({
		$schema: z
			.string()
			.optional()
			.meta({ description: "JSON Schema reference for editor support" }),
		version: z
			.number()
			.int()
			.positive()
			.meta({ description: "Storage schema version" }),
		accounts: z
			.array(AccountSchema)
			.meta({ description: "Managed account entries" }),
		activeEmail: z
			.string()
			.optional()
			.meta({ description: "Currently active account email" }),
	})
	.meta({
		id: "MultiCodexStorage",
		description: "MultiCodex managed account storage",
	});

export type Account = z.infer<typeof AccountSchema>;
export type StorageData = z.infer<typeof StorageSchema>;

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

const LEGACY_FIELDS = [
	"importSource",
	"importMode",
	"importFingerprint",
] as const;

function stripLegacyFields(raw: Record<string, unknown>): boolean {
	let stripped = false;
	for (const key of LEGACY_FIELDS) {
		if (key in raw) {
			delete raw[key];
			stripped = true;
		}
	}
	return stripped;
}

function migrateRawStorage(raw: unknown): StorageData {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return { version: CURRENT_VERSION, accounts: [], activeEmail: undefined };
	}

	const record = raw as Record<string, unknown>;

	// Strip legacy import fields from each account
	const rawAccounts = Array.isArray(record.accounts) ? record.accounts : [];
	for (const entry of rawAccounts) {
		if (entry && typeof entry === "object" && !Array.isArray(entry)) {
			stripLegacyFields(entry as Record<string, unknown>);
		}
	}

	// Add version if missing (pre-v1 files)
	if (!("version" in record) || typeof record.version !== "number") {
		record.version = CURRENT_VERSION;
	}

	const result = StorageSchema.safeParse(record);
	if (result.success) {
		return result.data;
	}

	// Schema validation failed — salvage what we can
	const accounts: Account[] = [];
	for (const entry of rawAccounts) {
		const parsed = AccountSchema.safeParse(entry);
		if (parsed.success) {
			accounts.push(parsed.data);
		}
	}
	return { version: CURRENT_VERSION, accounts, activeEmail: undefined };
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

export const STORAGE_FILE = getAgentPath("codex-accounts.json");

export function loadStorage(): StorageData {
	try {
		if (fs.existsSync(STORAGE_FILE)) {
			const text = fs.readFileSync(STORAGE_FILE, "utf-8");
			const raw = JSON.parse(text) as Record<string, unknown>;
			const needsMigration =
				!("version" in raw) ||
				raw.version !== CURRENT_VERSION ||
				needsLegacyStrip(raw);
			const data = migrateRawStorage(raw);
			if (needsMigration) {
				saveStorage(data);
			}
			return data;
		}
	} catch (error) {
		console.error("Failed to load multicodex accounts:", error);
	}

	return { version: CURRENT_VERSION, accounts: [], activeEmail: undefined };
}

function needsLegacyStrip(raw: Record<string, unknown>): boolean {
	const accounts = Array.isArray(raw.accounts) ? raw.accounts : [];
	for (const entry of accounts) {
		if (entry && typeof entry === "object" && !Array.isArray(entry)) {
			for (const key of LEGACY_FIELDS) {
				if (key in (entry as Record<string, unknown>)) return true;
			}
		}
	}
	return false;
}

export function saveStorage(data: StorageData): void {
	try {
		const dir = path.dirname(STORAGE_FILE);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
		const output = {
			$schema: SCHEMA_URL,
			version: CURRENT_VERSION,
			accounts: data.accounts,
			activeEmail: data.activeEmail,
		};
		fs.writeFileSync(STORAGE_FILE, JSON.stringify(output, null, 2));
	} catch (error) {
		console.error("Failed to save multicodex accounts:", error);
	}
}
