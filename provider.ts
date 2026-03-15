import {
	type Api,
	type AssistantMessageEventStream,
	type Context,
	getApiProvider,
	getModels,
	type Model,
	type SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import type { AccountManager } from "./account-manager";
import { createStreamWrapper } from "./stream-wrapper";

export const PROVIDER_ID = "openai-codex";

export interface ProviderModelDef {
	id: string;
	name: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
	};
	contextWindow: number;
	maxTokens: number;
}

export function getOpenAICodexMirror(): {
	baseUrl: string;
	models: ProviderModelDef[];
} {
	const sourceModels = getModels("openai-codex");
	return {
		baseUrl: sourceModels[0]?.baseUrl || "https://chatgpt.com/backend-api",
		models: sourceModels.map((model) => ({
			id: model.id,
			name: model.name,
			reasoning: model.reasoning,
			input: model.input,
			cost: model.cost,
			contextWindow: model.contextWindow,
			maxTokens: model.maxTokens,
		})),
	};
}

export function buildMulticodexProviderConfig(accountManager: AccountManager): {
	baseUrl: string;
	apiKey: string;
	api: "openai-codex-responses";
	streamSimple: (
		model: Model<Api>,
		context: Context,
		options?: SimpleStreamOptions,
	) => AssistantMessageEventStream;
	models: ProviderModelDef[];
} {
	const mirror = getOpenAICodexMirror();
	const baseProvider = getApiProvider("openai-codex-responses");
	if (!baseProvider) {
		throw new Error(
			"OpenAI Codex provider not available. Please update pi to include openai-codex support.",
		);
	}

	return {
		baseUrl: mirror.baseUrl,
		apiKey: "managed-by-extension",
		api: "openai-codex-responses",
		streamSimple: createStreamWrapper(accountManager, baseProvider),
		models: mirror.models,
	};
}
