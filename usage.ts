interface CodexUsageWindow {
	usedPercent?: number;
	resetAt?: number;
}

export interface CodexUsageSnapshot {
	primary?: CodexUsageWindow;
	secondary?: CodexUsageWindow;
	fetchedAt: number;
}

interface WhamUsageResponse {
	rate_limit?: {
		primary_window?: WhamUsageWindow;
		secondary_window?: WhamUsageWindow;
	};
}

type WhamUsageWindow = {
	reset_at?: number;
	used_percent?: number;
};

function normalizeUsedPercent(value?: number): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	return Math.min(100, Math.max(0, value));
}

function normalizeResetAt(value?: number): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	return value * 1000;
}

function parseUsageWindow(
	window?: WhamUsageWindow,
): CodexUsageWindow | undefined {
	if (!window) return undefined;
	const usedPercent = normalizeUsedPercent(window.used_percent);
	const resetAt = normalizeResetAt(window.reset_at);
	if (usedPercent === undefined && resetAt === undefined) return undefined;
	return { usedPercent, resetAt };
}

export function parseCodexUsageResponse(
	data: WhamUsageResponse,
): Omit<CodexUsageSnapshot, "fetchedAt"> {
	return {
		primary: parseUsageWindow(data.rate_limit?.primary_window),
		secondary: parseUsageWindow(data.rate_limit?.secondary_window),
	};
}

export function isUsageUntouched(usage?: CodexUsageSnapshot): boolean {
	const primary = usage?.primary?.usedPercent;
	const secondary = usage?.secondary?.usedPercent;
	if (primary === undefined || secondary === undefined) return false;
	return primary === 0 && secondary === 0;
}

export function getNextResetAt(usage?: CodexUsageSnapshot): number | undefined {
	const candidates = [
		usage?.primary?.resetAt,
		usage?.secondary?.resetAt,
	].filter((value): value is number => typeof value === "number");
	if (candidates.length === 0) return undefined;
	return Math.min(...candidates);
}

export function getMaxUsedPercent(
	usage?: CodexUsageSnapshot,
): number | undefined {
	const candidates = [
		usage?.primary?.usedPercent,
		usage?.secondary?.usedPercent,
	].filter((value): value is number => typeof value === "number");
	if (candidates.length === 0) return undefined;
	return Math.max(...candidates);
}

export function getWeeklyResetAt(
	usage?: CodexUsageSnapshot,
): number | undefined {
	const resetAt = usage?.secondary?.resetAt;
	return typeof resetAt === "number" ? resetAt : undefined;
}

export function formatResetAt(resetAt?: number): string {
	if (!resetAt) return "unknown";
	const diffMs = resetAt - Date.now();
	if (diffMs <= 0) return "now";
	const diffMinutes = Math.max(1, Math.round(diffMs / 60000));
	if (diffMinutes < 60) return `in ${diffMinutes}m`;
	const diffHours = Math.round(diffMinutes / 60);
	if (diffHours < 48) return `in ${diffHours}h`;
	const diffDays = Math.round(diffHours / 24);
	return `in ${diffDays}d`;
}
