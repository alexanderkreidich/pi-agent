import type { DiffCommandOptions } from "./args";
import type { ResolvedDiff } from "./source";

const MAX_PROMPT_CHARS = 60_000;
const MAX_MESSAGE_CHARS = 500_000;
const MAX_OVERLAY_CHARS = 5_000_000;

export interface DiffStats {
	files: number;
	additions: number;
	deletions: number;
}

export interface DiffMessageDetails {
	kind: "diff";
	sourceLabel: string;
	sourceKind: ResolvedDiff["sourceKind"];
	command?: string;
	stats: DiffStats;
	lineCount: number;
	storedLineCount: number;
	truncatedByBytes: boolean;
	truncatedByLines: boolean;
	lines: string[];
	generatedAt: number;
}

export interface HelpMessageDetails {
	kind: "help";
	help: string;
}

export function createDiffMessage(resolved: ResolvedDiff, options: DiffCommandOptions, limits: { maxChars?: number } = {}): {
	content: string;
	details: DiffMessageDetails;
} {
	const clipped = clipText(resolved.diff, limits.maxChars ?? MAX_MESSAGE_CHARS);
	const allLines = splitLines(clipped.text);
	const renderedLines = allLines.slice(0, options.maxLines);
	const stats = summarizeDiff(resolved.diff);
	const lineCount = splitLines(resolved.diff).length;
	const truncatedByLines = allLines.length > renderedLines.length;

	const content = `${resolved.sourceLabel}: ${stats.files} file${stats.files === 1 ? "" : "s"}, +${stats.additions}/-${stats.deletions}`;

	return {
		content,
		details: {
			kind: "diff",
			sourceLabel: resolved.sourceLabel,
			sourceKind: resolved.sourceKind,
			command: resolved.command,
			stats,
			lineCount,
			storedLineCount: renderedLines.length,
			truncatedByBytes: clipped.truncated,
			truncatedByLines,
			lines: renderedLines,
			generatedAt: Date.now(),
		},
	};
}

export interface ReviewPromptOptions {
	selectedFiles?: string[];
}

export function createReviewPrompt(resolved: ResolvedDiff, options: ReviewPromptOptions = {}): string {
	const selection = diffForSelectedFiles(resolved.diff, options.selectedFiles);
	const clipped = clipText(selection.diff, MAX_PROMPT_CHARS);
	const suffix = clipped.truncated
		? "\n\n[Diff truncated before sending to the agent. Ask the user to narrow the diff if exact omitted lines matter.]"
		: "";

	return `Review this diff from ${resolved.sourceLabel}.${selection.note}

Focus on correctness bugs, regressions, missing tests, risky edge cases, and security issues. Be concise. Do not restate the whole patch.

\`\`\`diff
${clipped.text}
\`\`\`${suffix}`;
}

export function createChangeRequestPrompt(
	resolved: ResolvedDiff,
	instructions: string,
	options: ReviewPromptOptions = {},
): string {
	const selection = diffForSelectedFiles(resolved.diff, options.selectedFiles);
	const clipped = clipText(selection.diff, MAX_PROMPT_CHARS);
	const suffix = clipped.truncated
		? "\n\n[Diff truncated before sending to the agent. Ask the user to narrow the diff if exact omitted lines matter.]"
		: "";

	return `The user reviewed this diff from ${resolved.sourceLabel} and asked for changes.${selection.note}

Requested changes:
${instructions.trim()}

Use the selected diff context below to make the requested changes. Focus only on the selected files unless the change requires a small supporting edit elsewhere.

\`\`\`diff
${clipped.text}
\`\`\`${suffix}`;
}

export function filterDiffByPaths(diffText: string, selectedFiles: string[]): string {
	const selected = new Set(selectedFiles.map(normalizeDiffPath).filter(Boolean));
	if (selected.size === 0) return "";

	const lines = splitLines(diffText);
	const sectionStarts: number[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (lines[i]!.startsWith("diff --git ")) sectionStarts.push(i);
	}

	if (sectionStarts.length === 0) {
		const singlePath = inferSinglePatchPath(lines);
		return !singlePath || selected.has(singlePath) ? diffText : "";
	}

	const selectedBlocks: string[] = [];
	for (let i = 0; i < sectionStarts.length; i++) {
		const start = sectionStarts[i]!;
		const end = sectionStarts[i + 1] ?? lines.length;
		const block = lines.slice(start, end);
		const paths = diffBlockPaths(block);
		if (paths.some((path) => selected.has(path))) selectedBlocks.push(block.join("\n"));
	}

	return selectedBlocks.join("\n");
}

function diffForSelectedFiles(diffText: string, selectedFiles: string[] | undefined): { diff: string; note: string } {
	if (!selectedFiles) return { diff: diffText, note: "" };
	const uniqueFiles = [...new Set(selectedFiles.map(normalizeDiffPath).filter(Boolean))];
	const filtered = filterDiffByPaths(diffText, uniqueFiles);
	const fileList = formatSelectedFiles(uniqueFiles);
	const note = `\n\nSelected files (${uniqueFiles.length}): ${fileList}`;
	return { diff: filtered, note };
}

function formatSelectedFiles(files: string[]): string {
	if (files.length === 0) return "none";
	const shown = files.slice(0, 20).join(", ");
	const remaining = files.length - 20;
	return remaining > 0 ? `${shown}, … and ${remaining} more` : shown;
}

function diffBlockPaths(lines: string[]): string[] {
	const paths = new Set<string>();
	const header = lines[0] ?? "";
	const headerMatch = /^diff --git\s+a\/(.*?)\s+b\/(.*)$/.exec(header);
	if (headerMatch) {
		paths.add(normalizeDiffPath(headerMatch[1] ?? ""));
		paths.add(normalizeDiffPath(headerMatch[2] ?? ""));
	}

	for (const line of lines) {
		if ((line.startsWith("+++ ") || line.startsWith("--- ")) && line.slice(4).trim() !== "/dev/null") {
			paths.add(normalizeDiffPath(line.slice(4)));
		}
		if (line.startsWith("rename from ")) paths.add(normalizeDiffPath(line.slice("rename from ".length)));
		if (line.startsWith("rename to ")) paths.add(normalizeDiffPath(line.slice("rename to ".length)));
	}

	return [...paths].filter(Boolean);
}

function inferSinglePatchPath(lines: string[]): string | undefined {
	for (const line of lines) {
		if (line.startsWith("+++ ") && line.slice(4).trim() !== "/dev/null") return normalizeDiffPath(line.slice(4));
	}
	for (const line of lines) {
		if (line.startsWith("--- ") && line.slice(4).trim() !== "/dev/null") return normalizeDiffPath(line.slice(4));
	}
	return undefined;
}

function normalizeDiffPath(path: string): string {
	return path.trim().replace(/\t/g, "    ").replace(/^a\//, "").replace(/^b\//, "");
}

export function summarizeDiff(diffText: string): DiffStats {
	let additions = 0;
	let deletions = 0;
	let files = 0;
	const seenFiles = new Set<string>();

	for (const line of splitLines(diffText)) {
		if (line.startsWith("diff --git ")) {
			files++;
			continue;
		}

		if (line.startsWith("+++ ")) {
			const name = line.slice(4).trim();
			if (name !== "/dev/null") seenFiles.add(name.replace(/^b\//, ""));
			continue;
		}

		if (line.startsWith("--- ")) {
			const name = line.slice(4).trim();
			if (name !== "/dev/null") seenFiles.add(name.replace(/^a\//, ""));
			continue;
		}

		if (line.startsWith("+") && !line.startsWith("+++")) additions++;
		else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
	}

	if (files === 0) files = seenFiles.size;
	if (files === 0 && diffText.trim().length > 0) files = 1;

	return { files, additions, deletions };
}

function splitLines(text: string): string[] {
	if (text.length === 0) return [];
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

export function overlayDiffLimits(options: DiffCommandOptions): { maxChars: number; maxLines: number } {
	return {
		maxChars: MAX_OVERLAY_CHARS,
		maxLines: options.maxLinesExplicit ? options.maxLines : 50_000,
	};
}

function clipText(text: string, maxChars: number): { text: string; truncated: boolean } {
	if (text.length <= maxChars) return { text, truncated: false };
	return { text: text.slice(0, maxChars), truncated: true };
}
