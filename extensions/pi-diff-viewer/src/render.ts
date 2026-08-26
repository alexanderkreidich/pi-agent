import { Box, Text, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import type { DiffMessageDetails, HelpMessageDetails } from "./diff-message";

interface RenderOptions {
	expanded?: boolean;
}

interface ThemeLike {
	bold(text: string): string;
	fg(color: string, text: string): string;
	bg(color: string, text: string): string;
}

export function renderDiffMessage(
	message: { content: unknown; details?: DiffMessageDetails | HelpMessageDetails },
	options: RenderOptions,
	theme: ThemeLike,
): Component {
	const details = message.details;
	if (!details) return new Text(contentToString(message.content), 0, 0);
	if (details.kind === "help") return renderHelp(details, theme);
	return renderDiff(details, options, theme);
}

function contentToString(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((part) => {
				if (part && typeof part === "object" && "text" in part && typeof part.text === "string") return part.text;
				return "";
			})
			.join("\n");
	}
	return String(content ?? "");
}

function renderHelp(details: HelpMessageDetails, theme: ThemeLike): Component {
	const box = new Box(1, 1, (text: string) => theme.bg("customMessageBg", text));
	box.addChild(new Text(theme.fg("accent", theme.bold("Pi Diff Viewer")) + "\n\n" + details.help, 0, 0));
	return box;
}

function renderDiff(details: DiffMessageDetails, options: RenderOptions, theme: ThemeLike): Component {
	return {
		render(width: number): string[] {
			const safeWidth = Math.max(20, width);
			const header = formatHeader(details, theme);
			const lines: string[] = [truncateToWidth(header, safeWidth)];

			if (details.command) {
				lines.push(truncateToWidth(theme.fg("dim", details.command), safeWidth));
			}

			if (details.truncatedByBytes || details.truncatedByLines) {
				const warning = `Showing ${details.storedLineCount}/${details.lineCount} lines${details.truncatedByBytes ? ", clipped at 500 KB" : ""}.`;
				lines.push(truncateToWidth(theme.fg("warning", warning), safeWidth));
			}

			const visibleLines = options.expanded ? details.lines : details.lines.slice(0, 120);
			if (!options.expanded && details.lines.length > visibleLines.length) {
				lines.push(truncateToWidth(theme.fg("dim", `Collapsed preview: first ${visibleLines.length} lines. Expand tool/message output to see ${details.lines.length} stored lines.`), safeWidth));
			}

			for (const line of visibleLines) {
				lines.push(truncateToWidth(styleDiffLine(line, theme), safeWidth, "…"));
			}

			return lines;
		},
		invalidate() {},
	};
}

function formatHeader(details: DiffMessageDetails, theme: ThemeLike): string {
	const { stats } = details;
	const fileText = `${stats.files} file${stats.files === 1 ? "" : "s"}`;
	return [
		theme.fg("accent", theme.bold("Δ diff")),
		theme.fg("muted", details.sourceLabel),
		theme.fg("dim", fileText),
		theme.fg("success", `+${stats.additions}`),
		theme.fg("error", `-${stats.deletions}`),
	].join("  ");
}

function styleDiffLine(line: string, theme: ThemeLike): string {
	if (line.startsWith("diff --git ")) return theme.fg("accent", theme.bold(line));
	if (line.startsWith("@@")) return theme.fg("accent", line);
	if (line.startsWith("+++ ") || line.startsWith("--- ")) return theme.fg("muted", line);
	if (line.startsWith("+") && !line.startsWith("+++")) return theme.fg("success", line);
	if (line.startsWith("-") && !line.startsWith("---")) return theme.fg("error", line);
	if (line.startsWith("\\ No newline")) return theme.fg("warning", line);
	if (
		line.startsWith("index ") ||
		line.startsWith("new file mode ") ||
		line.startsWith("deleted file mode ") ||
		line.startsWith("similarity index ") ||
		line.startsWith("rename from ") ||
		line.startsWith("rename to ")
	) {
		return theme.fg("dim", line);
	}
	return theme.fg("toolDiffContext", line);
}
