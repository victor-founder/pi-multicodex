import { describe, expect, it } from "vitest";
import { parseImportedOpenAICodexAuth } from "./auth";

describe("parseImportedOpenAICodexAuth", () => {
	it("parses oauth credentials from pi auth.json data", () => {
		const parsed = parseImportedOpenAICodexAuth({
			"openai-codex": {
				type: "oauth",
				access: "access-token",
				refresh: "refresh-token",
				expires: 123,
				accountId: "acct-1234567890",
			},
		});

		expect(parsed).toEqual({
			identifier: "OpenAI Codex acct-123",
			fingerprint: JSON.stringify({
				access: "access-token",
				refresh: "refresh-token",
				expires: 123,
				accountId: "acct-1234567890",
			}),
			credentials: {
				access: "access-token",
				refresh: "refresh-token",
				expires: 123,
				accountId: "acct-1234567890",
			},
		});
	});

	it("returns undefined for missing or invalid oauth data", () => {
		expect(parseImportedOpenAICodexAuth({})).toBeUndefined();
		expect(
			parseImportedOpenAICodexAuth({
				"openai-codex": { type: "oauth", access: "", refresh: "x", expires: 1 },
			}),
		).toBeUndefined();
		expect(
			parseImportedOpenAICodexAuth({
				"openai-codex": {
					type: "api-key",
					access: "x",
					refresh: "y",
					expires: 1,
				},
			}),
		).toBeUndefined();
	});
});
