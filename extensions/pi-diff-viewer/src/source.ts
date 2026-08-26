import { access, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { DiffCommandOptions } from "./args";

export interface ResolvedDiff {
	diff: string;
	sourceLabel: string;
	sourceKind: "git" | "patch-file" | "inline-patch";
	branch?: string;
	command?: string;
}

export type ResolveDiffResult = { ok: true; value: ResolvedDiff } | { ok: false; error: string };

interface PiExec {
	exec(command: string, args: string[], options?: { cwd?: string; timeout?: number; signal?: AbortSignal }): Promise<{
		stdout?: string;
		stderr?: string;
		code?: number | null;
		killed?: boolean;
	}>;
}

interface CommandContextLike {
	cwd: string;
	signal?: AbortSignal;
}

export async function resolveDiffInput(
	pi: PiExec,
	ctx: CommandContextLike,
	options: DiffCommandOptions,
): Promise<ResolveDiffResult> {
	if (looksLikePatchText(options.raw) && !options.gitMode) {
		return {
			ok: true,
			value: {
				diff: options.raw,
				sourceLabel: "inline patch",
				sourceKind: "inline-patch",
			},
		};
	}

	if (options.gitMode) {
		return runGitDiff(pi, ctx, options.gitArgs, `git diff ${options.gitArgs.join(" ")}`.trim(), { fullFileContext: false });
	}

	const pathArgs = options.positionals.map(stripAtPrefix);

	if (pathArgs.length === 1) {
		const patchFile = await readPatchFileIfPresent(ctx.cwd, pathArgs[0]!);
		if (patchFile.ok) return patchFile;
	}

	const gitArgs: string[] = [];
	if (options.staged) gitArgs.push("--cached");
	if (pathArgs.length > 0) gitArgs.push("--", ...pathArgs);

	const label = pathArgs.length > 0
		? `${options.staged ? "staged " : ""}git diff for ${pathArgs.join(", ")}`
		: options.staged
			? "staged git diff"
			: "working-tree git diff";

	return runGitDiff(pi, ctx, gitArgs, label);
}

async function runGitDiff(
	pi: PiExec,
	ctx: CommandContextLike,
	gitArgs: string[],
	sourceLabel: string,
	options: { fullFileContext?: boolean } = {},
): Promise<ResolveDiffResult> {
	const effectiveGitArgs = options.fullFileContext === false ? gitArgs : withFullFileContext(gitArgs);
	const args = ["diff", "--no-color", "--no-ext-diff", ...effectiveGitArgs];
	const [result, branch] = await Promise.all([
		pi.exec("git", args, { cwd: ctx.cwd, timeout: 30_000, signal: ctx.signal }),
		readCurrentGitBranch(pi, ctx),
	]);
	const code = result.code ?? 0;
	if (code !== 0) {
		const stderr = (result.stderr ?? "").trim();
		const stdout = (result.stdout ?? "").trim();
		const reason = stderr || stdout || `git diff exited with code ${code}`;
		return { ok: false, error: reason };
	}

	return {
		ok: true,
		value: {
			diff: result.stdout ?? "",
			sourceLabel: formatGitSourceLabel(sourceLabel, branch),
			sourceKind: "git",
			branch,
			command: `git ${args.map(shellQuoteForDisplay).join(" ")}`,
		},
	};
}

async function readPatchFileIfPresent(cwd: string, maybePath: string): Promise<ResolveDiffResult> {
	const absolute = resolve(cwd, maybePath);
	try {
		await access(absolute);
		const info = await stat(absolute);
		if (!info.isFile()) return { ok: false, error: `${maybePath} is not a file` };
		const text = await readFile(absolute, "utf8");
		if (!looksLikePatchText(text)) return { ok: false, error: `${maybePath} exists but is not a unified patch` };
		return {
			ok: true,
			value: {
				diff: text,
				sourceLabel: maybePath,
				sourceKind: "patch-file",
			},
		};
	} catch {
		return { ok: false, error: "not-present" };
	}
}

export function looksLikePatchText(text: string): boolean {
	const trimmed = text.trimStart();
	return (
		trimmed.startsWith("diff --git ") ||
		trimmed.startsWith("--- ") ||
		trimmed.startsWith("Index: ") ||
		/^@@\s/m.test(trimmed)
	);
}

async function readCurrentGitBranch(pi: PiExec, ctx: CommandContextLike): Promise<string | undefined> {
	const branch = await pi.exec("git", ["branch", "--show-current"], { cwd: ctx.cwd, timeout: 5_000, signal: ctx.signal });
	const branchName = (branch.stdout ?? "").trim();
	if (branchName) return branchName;

	const commit = await pi.exec("git", ["rev-parse", "--short", "HEAD"], { cwd: ctx.cwd, timeout: 5_000, signal: ctx.signal });
	const shortSha = (commit.stdout ?? "").trim();
	return shortSha ? `detached ${shortSha}` : undefined;
}

function formatGitSourceLabel(sourceLabel: string, branch: string | undefined): string {
	if (!branch) return sourceLabel;
	if (sourceLabel === "working-tree git diff") return `${branch} · working tree`;
	if (sourceLabel === "staged git diff") return `${branch} · staged`;
	if (sourceLabel.startsWith("staged git diff for ")) return `${branch} · staged · ${sourceLabel.slice("staged git diff for ".length)}`;
	if (sourceLabel.startsWith("git diff for ")) return `${branch} · ${sourceLabel.slice("git diff for ".length)}`;
	return `${branch} · ${sourceLabel}`;
}

function withFullFileContext(gitArgs: string[]): string[] {
	if (gitArgs.some(isContextOption)) return gitArgs;
	return ["--unified=999999", ...gitArgs];
}

function isContextOption(arg: string): boolean {
	return arg === "--unified" || arg.startsWith("--unified=") || arg === "--inter-hunk-context" || arg.startsWith("--inter-hunk-context=") || /^-U\d*$/.test(arg);
}

function stripAtPrefix(value: string): string {
	return value.startsWith("@") ? value.slice(1) : value;
}

function shellQuoteForDisplay(value: string): string {
	if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}
