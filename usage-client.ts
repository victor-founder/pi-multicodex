import { createTimeoutController } from "./abort-utils";
import { type CodexUsageSnapshot, parseCodexUsageResponse } from "./usage";

interface WhamUsageResponse {
	rate_limit?: {
		primary_window?: {
			reset_at?: number;
			used_percent?: number;
		};
		secondary_window?: {
			reset_at?: number;
			used_percent?: number;
		};
	};
}

export async function fetchCodexUsage(
	accessToken: string,
	accountId: string | undefined,
	options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<CodexUsageSnapshot> {
	const { controller, clear } = createTimeoutController(
		options?.signal,
		options?.timeoutMs ?? 10_000,
	);

	try {
		const headers: Record<string, string> = {
			Authorization: `Bearer ${accessToken}`,
			Accept: "application/json",
		};
		if (accountId) {
			headers["ChatGPT-Account-Id"] = accountId;
		}

		const response = await fetch("https://chatgpt.com/backend-api/wham/usage", {
			headers,
			signal: controller.signal,
		});

		if (!response.ok) {
			throw new Error(`Usage request failed: ${response.status}`);
		}

		const data = (await response.json()) as WhamUsageResponse;
		return { ...parseCodexUsageResponse(data), fetchedAt: Date.now() };
	} finally {
		clear();
	}
}
