import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentPath } from "pi-provider-utils/agent-paths";

export interface Account {
	email: string;
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
	accountId?: string;
	lastUsed?: number;
	quotaExhaustedUntil?: number;
	importSource?: "pi-openai-codex";
	importMode?: "linked" | "synthetic";
	importFingerprint?: string;
	needsReauth?: boolean;
}

export interface StorageData {
	accounts: Account[];
	activeEmail?: string;
}

export const STORAGE_FILE = getAgentPath("codex-accounts.json");

export function loadStorage(): StorageData {
	try {
		if (fs.existsSync(STORAGE_FILE)) {
			return JSON.parse(fs.readFileSync(STORAGE_FILE, "utf-8")) as StorageData;
		}
	} catch (error) {
		console.error("Failed to load multicodex accounts:", error);
	}

	return { accounts: [] };
}

export function saveStorage(data: StorageData): void {
	try {
		const dir = path.dirname(STORAGE_FILE);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
		fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2));
	} catch (error) {
		console.error("Failed to save multicodex accounts:", error);
	}
}
