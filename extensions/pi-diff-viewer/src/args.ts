export interface DiffCommandOptions {
	raw: string;
	help: boolean;
	ask: boolean;
	staged: boolean;
	gitMode: boolean;
	maxLines: number;
	maxLinesExplicit: boolean;
	noOverlay: boolean;
	positionals: string[];
	gitArgs: string[];
}

export type DiffCommandParseResult =
	| { ok: true; options: DiffCommandOptions }
	| { ok: false; error: string };

const DEFAULT_MAX_LINES = 10_000;

export function parseDiffCommandArgs(rawArgs: string, overrides: Partial<DiffCommandOptions> = {}): DiffCommandParseResult {
	const raw = rawArgs.trim();
	const split = splitShellLike(raw);
	if (!split.ok) return split;

	const tokens = split.tokens;
	const options: DiffCommandOptions = {
		raw,
		help: false,
		ask: false,
		staged: false,
		gitMode: false,
		maxLines: DEFAULT_MAX_LINES,
		maxLinesExplicit: false,
		noOverlay: false,
		positionals: [],
		gitArgs: [],
		...overrides,
	};

	let passthrough = false;
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i]!;

		if (options.gitMode) {
			options.gitArgs.push(token);
			continue;
		}

		if (passthrough) {
			options.positionals.push(token);
			continue;
		}

		if (token === "--") {
			passthrough = true;
			continue;
		}

		if (token === "git") {
			options.gitMode = true;
			continue;
		}

		if (token === "--help" || token === "-h") {
			options.help = true;
			continue;
		}

		if (token === "--ask" || token === "--review") {
			options.ask = true;
			continue;
		}

		if (token === "--no-overlay" || token === "--inline" || token === "--message-only") {
			options.noOverlay = true;
			continue;
		}

		if (token === "--staged" || token === "--cached") {
			options.staged = true;
			continue;
		}

		if (token === "--max-lines" || token.startsWith("--max-lines=")) {
			const value = token === "--max-lines" ? tokens[++i] : token.slice("--max-lines=".length);
			if (!value) return { ok: false, error: "--max-lines requires a number" };
			const parsed = Number.parseInt(value, 10);
			if (!Number.isFinite(parsed) || parsed <= 0) {
				return { ok: false, error: "--max-lines must be a positive number" };
			}
			options.maxLines = Math.min(parsed, 50_000);
			options.maxLinesExplicit = true;
			continue;
		}

		if (token.startsWith("--")) {
			return {
				ok: false,
				error: `Unknown /diff option ${token}. Use /diff git ${token} ... to pass raw git diff options.`,
			};
		}

		options.positionals.push(token);
	}

	return { ok: true, options };
}

function splitShellLike(input: string): { ok: true; tokens: string[] } | { ok: false; error: string } {
	const tokens: string[] = [];
	let current = "";
	let quote: "'" | '"' | undefined;
	let escaped = false;

	for (const char of input) {
		if (escaped) {
			current += char;
			escaped = false;
			continue;
		}

		if (char === "\\" && quote !== "'") {
			escaped = true;
			continue;
		}

		if (quote) {
			if (char === quote) quote = undefined;
			else current += char;
			continue;
		}

		if (char === "'" || char === '"') {
			quote = char;
			continue;
		}

		if (/\s/.test(char)) {
			if (current.length > 0) {
				tokens.push(current);
				current = "";
			}
			continue;
		}

		current += char;
	}

	if (escaped) current += "\\";
	if (quote) return { ok: false, error: `Unclosed ${quote} quote in /diff arguments` };
	if (current.length > 0) tokens.push(current);
	return { ok: true, tokens };
}

export const DIFF_USAGE = `/diff usage:
  /diff                         Show current working-tree git diff
  /diff --staged                Show staged git diff
  /diff <path>                  Show git diff for a path, or render a patch file
  /diff <path> <path...>        Show git diff for multiple paths
  /diff git <git-diff-args...>  Pass arguments directly to git diff
  /diff --max-lines=200         Cap stored/rendered diff lines for the session message
  /diff --no-overlay            Keep the diff inline instead of opening the overlay viewer
  /diff --ask [source]          Render the diff, select review files, then ask the agent
  /review-diff [source]         Shortcut for /diff --ask [source]

Examples:
  /diff
  /diff --staged src/index.ts
  /diff changes.patch
  /diff git HEAD~1..HEAD -- src
  /review-diff --staged`;
