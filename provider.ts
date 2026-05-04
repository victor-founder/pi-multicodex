import { getApiProvider, getModels } from "@mariozechner/pi-ai";
import type { ProviderModelConfig } from "@mariozechner/pi-coding-agent";
import type { AccountManager } from "./account-manager";
import { createStreamWrapper } from "./stream-wrapper";

export const PROVIDER_ID = "openai-codex";

export type ProviderModelDef = ProviderModelConfig;

export function getOpenAICodexMirror(): {
	baseUrl: string;
	models: ProviderModelConfig[];
} {
	const sourceModels = getModels("openai-codex");
	return {
		baseUrl: sourceModels[0]?.baseUrl ?? "https://chatgpt.com/backend-api",
		models: sourceModels.map((m) => ({
			id: m.id,
			name: m.name,
			api: m.api,
			baseUrl: m.baseUrl,
			reasoning: m.reasoning,
			thinkingLevelMap: m.thinkingLevelMap
				? { ...m.thinkingLevelMap }
				: undefined,
			input: [...m.input],
			cost: { ...m.cost },
			contextWindow: m.contextWindow,
			maxTokens: m.maxTokens,
			headers: m.headers ? { ...m.headers } : undefined,
			compat: m.compat,
		})),
	};
}

function getActiveApiKey(accountManager: AccountManager): string {
	const active = accountManager.getActiveAccount();
	if (active && !active.needsReauth) {
		return active.accessToken;
	}
	// Fallback: first available account with a valid token.
	for (const account of accountManager.getAccounts()) {
		if (!account.needsReauth && account.accessToken) {
			return account.accessToken;
		}
	}
	// Fallback placeholder until MultiCodex resolves a usable managed account.
	return "pending-login";
}

export function buildMulticodexProviderConfig(accountManager: AccountManager) {
	const mirror = getOpenAICodexMirror();
	const baseProvider = getApiProvider("openai-codex-responses");
	if (!baseProvider) {
		throw new Error(
			"OpenAI Codex provider not available. Please update pi to include openai-codex support.",
		);
	}

	return {
		baseUrl: mirror.baseUrl,
		apiKey: getActiveApiKey(accountManager),
		api: "openai-codex-responses" as const,
		streamSimple: createStreamWrapper(accountManager, baseProvider),
		models: mirror.models,
	};
}
