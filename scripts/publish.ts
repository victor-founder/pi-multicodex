#!/usr/bin/env bun

import path from "node:path";
import { $ } from "bun";

class ReleaseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ReleaseError";
	}
}

function fail(message: string): never {
	throw new ReleaseError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Object.prototype.toString.call(value) === "[object Object]";
}

function getRequiredStringField(
	value: Record<string, unknown>,
	key: string,
): string {
	const field = value[key];
	if (Object.prototype.toString.call(field) !== "[object String]") {
		fail(`package.json is missing ${key}`);
	}
	return String(field);
}

async function readPackageJson(): Promise<Record<string, unknown>> {
	const packageJsonPath = path.join(process.cwd(), "package.json");
	const parsed: unknown = await Bun.file(packageJsonPath).json();
	if (!isRecord(parsed)) {
		fail("package.json must contain a JSON object");
	}
	return parsed;
}

async function setPackageVersion(version: string): Promise<void> {
	await $`bun pm pkg set ${`version=${version}`}`;
}

function normalizeVersionArg(arg: string | undefined): string | undefined {
	if (!arg) return undefined;
	const trimmed = arg.trim();
	if (!trimmed) return undefined;
	return trimmed.startsWith("v") ? trimmed.slice(1) : trimmed;
}

function incrementPatchVersion(version: string): string {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	if (!match) {
		fail(
			`automatic patch bump only supports x.y.z versions, received ${version}`,
		);
	}
	const [, major, minor, patch] = match;
	return `${major}.${minor}.${Number.parseInt(patch, 10) + 1}`;
}

async function isCleanGit(): Promise<boolean> {
	const result = await $`git status --porcelain`.quiet().nothrow();
	if (result.exitCode !== 0) {
		return true;
	}
	return result.stdout.toString().trim().length === 0;
}

async function npmVersionExists(
	pkgName: string,
	version: string,
): Promise<boolean> {
	const result = await $`npm view ${`${pkgName}@${version}`} version --json`
		.quiet()
		.nothrow();
	if (result.exitCode === 0) {
		return true;
	}
	const stderr = result.stderr.toString();
	if (stderr.includes("E404") || stderr.includes("404 Not Found")) {
		return false;
	}
	fail(`failed to query npm for ${pkgName}@${version}`);
}

async function restorePackageVersion(version: string): Promise<void> {
	await setPackageVersion(version);
}

async function runChecks(): Promise<void> {
	console.log("[release] running checks (lint, tsgo, test)");
	await $`npm run lint`;
	await $`npm run tsgo`;
	await $`npm run test`;
	console.log("[release] npm pack --dry-run");
	await $`npm pack --dry-run`;
}

async function main(): Promise<void> {
	const rawArgs = Bun.argv.slice(2);
	const dryRun = rawArgs.includes("--dry-run");
	const args = rawArgs.filter((arg) => arg !== "--dry-run");
	const requestedVersion = normalizeVersionArg(args[0]);

	if (!(await isCleanGit())) {
		fail("git working tree is not clean. Commit/stash first.");
	}

	const originalPkg = await readPackageJson();
	const packageName = getRequiredStringField(originalPkg, "name");
	const currentVersion = getRequiredStringField(originalPkg, "version");
	const targetVersion =
		requestedVersion ?? incrementPatchVersion(currentVersion);
	const shouldWriteVersion = targetVersion !== currentVersion;
	let shouldRestoreVersion = false;

	console.log(`[release] package: ${packageName}`);
	console.log(`[release] current version (package.json): ${currentVersion}`);
	console.log(`[release] target version: ${targetVersion}`);

	if (await npmVersionExists(packageName, targetVersion)) {
		fail(`version ${targetVersion} already exists on npm for ${packageName}`);
	}

	try {
		if (shouldWriteVersion) {
			await setPackageVersion(targetVersion);
			console.log(`[release] wrote package.json version ${targetVersion}`);
		}

		await runChecks();

		console.log("\n[release] local release preparation complete.");
		console.log("[release] next steps:");
		console.log("  git add package.json");
		console.log(`  git commit -m "release: v${targetVersion}"`);
		console.log(`  git tag v${targetVersion}`);
		console.log("  git push origin main --tags");
		console.log(
			"  wait for GitHub Actions trusted publishing to publish the tag",
		);

		if (dryRun) {
			shouldRestoreVersion = shouldWriteVersion;
			console.log(
				"\n[release] dry-run complete. Version bump will be reverted.",
			);
		}
	} finally {
		if (shouldRestoreVersion) {
			await restorePackageVersion(currentVersion);
			console.log(`[release] restored package.json version ${currentVersion}`);
		}
	}
}

try {
	await main();
} catch (error) {
	if (error instanceof ReleaseError) {
		console.error(`\n[release] ${error.message}`);
		process.exit(1);
	}
	throw error;
}
