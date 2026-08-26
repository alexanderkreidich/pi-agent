import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import type { DiffMessageDetails } from "./diff-message";

interface DiffSection {
	index: number;
	title: string;
	status: "added" | "deleted" | "modified" | "renamed";
	startLine: number;
	endLine: number;
	additions: number;
	deletions: number;
}

interface DisplayRow {
	kind: "file" | "gap" | "context" | "delete" | "add" | "note";
	sectionIndex: number;
	title?: string;
	status?: DiffSection["status"];
	additions?: number;
	deletions?: number;
	note?: string;
	oldLine?: number;
	newLine?: number;
	text?: string;
}

interface HunkHeader {
	oldStart: number;
	oldCount: number;
	newStart: number;
	newCount: number;
	label: string;
}

interface ThemeLike {
	bold(text: string): string;
	fg(color: string, text: string): string;
	bg(color: string, text: string): string;
}

interface MouseWheelEvent {
	direction: -1 | 1;
	x: number;
	y: number;
}

interface MouseClickEvent {
	button: "left";
	x: number;
	y: number;
}

export interface DiffOverlayOptions {
	selectableFiles?: boolean;
}

export interface DiffOverlayResult {
	action: "close" | "review";
	selectedFiles: string[];
}

const MOUSE_MODE_ENABLE = "\x1b[?1000h\x1b[?1006h";
const MOUSE_MODE_DISABLE = "\x1b[?1000l\x1b[?1006l";
const MOUSE_WHEEL_LINES = 3;

export async function showDiffOverlay(
	ctx: ExtensionCommandContext,
	details: DiffMessageDetails,
	options: DiffOverlayOptions = {},
): Promise<DiffOverlayResult> {
	let component: DiffOverlayComponent | undefined;
	try {
		return await ctx.ui.custom<DiffOverlayResult>((tui, theme, _keybindings, done) => {
			component = new DiffOverlayComponent(tui, theme, details, done, options);
			return component;
		}, {
			overlay: true,
			overlayOptions: {
				row: 0,
				col: 0,
				anchor: "top-left",
				width: "100%",
				maxHeight: "100%",
				margin: 0,
			},
		});
	} finally {
		component?.disableMouse();
	}
}

class DiffOverlayComponent implements Component {
	private readonly sections: DiffSection[];
	private readonly rows: DisplayRow[];
	private selectedFile = 0;
	private scrollRow = 0;
	private focus: "files" | "patch" = "patch";
	private showFileList = true;
	private mouseEnabled = false;
	private readonly selectableFiles: boolean;
	private readonly selectedFiles = new Set<number>();

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly details: DiffMessageDetails,
		private readonly done: (result: DiffOverlayResult) => void,
		options: DiffOverlayOptions = {},
	) {
		this.selectableFiles = options.selectableFiles === true;
		this.sections = parseDiffSections(details.lines, details.sourceLabel);
		this.rows = buildDisplayRows(details.lines, this.sections);
		this.scrollRow = this.firstRowForSection(0);
		this.enableMouse();
	}

	handleInput(data: string): void {
		const wheel = parseMouseWheel(data);
		if (wheel) {
			this.handleMouseWheel(wheel);
			return;
		}

		const click = parseMouseClick(data);
		if (click) {
			this.handleMouseClick(click);
			return;
		}

		const pageSize = this.pageSize();

		if (matchesKey(data, "escape") || data === "q") {
			this.close("close");
			return;
		}

		if (this.selectableFiles && data === "r") {
			this.close("review");
			return;
		}

		if (this.selectableFiles && data === " ") {
			this.toggleSelectedFile();
			this.tui.requestRender();
			return;
		}

		if (this.selectableFiles && data === "a") {
			this.selectAllFiles();
			this.tui.requestRender();
			return;
		}

		if (this.selectableFiles && data === "x") {
			this.clearSelectedFiles();
			this.tui.requestRender();
			return;
		}

		if (matchesKey(data, "tab")) {
			this.focus = this.focus === "files" ? "patch" : "files";
			this.tui.requestRender();
			return;
		}

		if (data === "f") {
			this.showFileList = !this.showFileList;
			if (!this.showFileList) this.focus = "patch";
			this.tui.requestRender();
			return;
		}

		if (matchesKey(data, "super+down")) {
			this.jumpToChangedLine(1);
			this.tui.requestRender();
			return;
		}

		if (matchesKey(data, "super+up")) {
			this.jumpToChangedLine(-1);
			this.tui.requestRender();
			return;
		}

		if (data === "n") {
			this.moveSelectedFile(1);
			this.tui.requestRender();
			return;
		}

		if (data === "p") {
			this.moveSelectedFile(-1);
			this.tui.requestRender();
			return;
		}

		if (this.focus === "files" && this.showFileList) {
			if (matchesKey(data, "down") || data === "j") this.moveSelectedFile(1);
			else if (matchesKey(data, "up") || data === "k") this.moveSelectedFile(-1);
			else if (matchesKey(data, "return") || matchesKey(data, "right")) this.focus = "patch";
			else if (matchesKey(data, "pageDown")) this.moveSelectedFile(Math.max(1, Math.floor(pageSize / 2)));
			else if (matchesKey(data, "pageUp")) this.moveSelectedFile(-Math.max(1, Math.floor(pageSize / 2)));
			this.tui.requestRender();
			return;
		}

		if (matchesKey(data, "down") || data === "j") this.scrollBy(1);
		else if (matchesKey(data, "up") || data === "k") this.scrollBy(-1);
		else if (matchesKey(data, "pageDown") || matchesKey(data, "ctrl+f")) this.scrollBy(pageSize);
		else if (matchesKey(data, "pageUp") || matchesKey(data, "ctrl+b")) this.scrollBy(-pageSize);
		else if (matchesKey(data, "home")) this.scrollTo(0);
		else if (matchesKey(data, "end")) this.scrollTo(this.rows.length - pageSize);
		else if (matchesKey(data, "left") && this.showFileList) this.focus = "files";
		else return;

		this.syncSelectedFileToScroll();
		this.tui.requestRender();
	}

	render(width: number): string[] {
		const safeWidth = Math.max(4, width);
		const height = this.overlayHeight();
		const innerWidth = Math.max(2, safeWidth - 2);
		const bodyHeight = Math.max(1, height - 6);
		const th = this.theme as ThemeLike;
		const lines: string[] = [];

		lines.push(th.fg("borderMuted", `╭${"─".repeat(innerWidth)}╮`));
		lines.push(this.frameLine(this.renderHeader(innerWidth), innerWidth));
		lines.push(th.fg("borderMuted", `├${"─".repeat(innerWidth)}┤`));

		const listWidth = this.fileListWidth(innerWidth);
		const patchWidth = listWidth > 0 ? innerWidth - listWidth - 1 : innerWidth;
		const fileRows = listWidth > 0 ? this.renderFileRows(listWidth, bodyHeight) : [];
		const patchRows = this.renderPatchRows(patchWidth, bodyHeight);

		for (let i = 0; i < bodyHeight; i++) {
			let body: string;
			if (listWidth > 0) {
				body = `${fileRows[i] ?? " ".repeat(listWidth)}${th.fg("borderMuted", "│")}${patchRows[i] ?? " ".repeat(patchWidth)}`;
			} else {
				body = patchRows[i] ?? " ".repeat(patchWidth);
			}
			lines.push(this.frameLine(body, innerWidth));
		}

		lines.push(th.fg("borderMuted", `├${"─".repeat(innerWidth)}┤`));
		lines.push(this.frameLine(this.renderFooter(innerWidth), innerWidth));
		lines.push(th.fg("borderMuted", `╰${"─".repeat(innerWidth)}╯`));
		return lines;
	}

	invalidate(): void {}

	disableMouse(): void {
		if (!this.mouseEnabled) return;
		this.tui.terminal.write?.(MOUSE_MODE_DISABLE);
		this.mouseEnabled = false;
	}

	private enableMouse(): void {
		if (this.mouseEnabled) return;
		this.tui.terminal.write?.(MOUSE_MODE_ENABLE);
		this.mouseEnabled = true;
	}

	private close(action: DiffOverlayResult["action"]): void {
		this.disableMouse();
		this.done({ action, selectedFiles: this.selectedFileTitles() });
	}

	private overlayHeight(): number {
		const rows = this.tui.terminal.rows || 24;
		return Math.max(7, rows);
	}

	private pageSize(): number {
		return Math.max(1, this.overlayHeight() - 6);
	}

	private fileListWidth(innerWidth: number): number {
		if (!this.showFileList || innerWidth < 92 || (!this.selectableFiles && this.sections.length <= 1)) return 0;
		return Math.min(34, Math.max(26, Math.floor(innerWidth * 0.24)));
	}

	private renderHeader(width: number): string {
		const th = this.theme as ThemeLike;
		const stats = this.details.stats;
		const left = [
			th.fg("accent", th.bold("Δ diff")),
			th.fg("muted", this.details.sourceLabel),
			th.fg("dim", `${stats.files} file${stats.files === 1 ? "" : "s"}`),
			th.fg("success", `+${stats.additions}`),
			th.fg("error", `-${stats.deletions}`),
		].join("  ");
		const help = this.selectableFiles
			? "review select • click/space include • a all • x clear • r review • q ask"
			: "unified • wheel scroll • ⌘↓/⌘↑ change • n/p file • q close";
		const right = th.fg("dim", help);
		return joinLeftRight(left, right, width);
	}

	private renderFooter(width: number): string {
		const th = this.theme as ThemeLike;
		const start = Math.min(this.scrollRow + 1, Math.max(1, this.rows.length));
		const end = Math.min(this.rows.length, this.scrollRow + this.pageSize());
		const selected = this.sections[this.selectedFile];
		const file = selected ? th.fg("muted", selected.title) : th.fg("muted", this.details.sourceLabel);
		const selection = this.selectableFiles
			? th.fg("dim", `  ${this.selectedFiles.size}/${this.sections.length} selected`)
			: "";
		const range = th.fg("dim", `rows ${start}-${end}/${this.rows.length}`);
		const warning = this.details.truncatedByBytes || this.details.truncatedByLines
			? th.fg("warning", "truncated")
			: "";
		return joinLeftRight(`${file}${selection}${warning ? `  ${warning}` : ""}`, range, width);
	}

	private renderFileRows(width: number, height: number): string[] {
		const th = this.theme as ThemeLike;
		const rows: string[] = [];
		const title = this.focus === "files" ? th.fg("accent", th.bold(" Files")) : th.fg("muted", " Files");
		rows.push(padAnsi(title, width));

		const maxRows = height - 1;
		const start = this.visibleFileStart(height);
		const visible = this.sections.slice(start, start + maxRows);
		for (const section of visible) {
			const isSelected = section.index === this.selectedFile;
			const cursor = isSelected ? "▶" : " ";
			const checkbox = this.selectableFiles ? (this.selectedFiles.has(section.index) ? "[x]" : "[ ]") : "";
			const icon = statusIcon(section.status);
			const counts = `${section.additions ? `+${section.additions}` : ""}${section.deletions ? ` -${section.deletions}` : ""}`.trim();
			const prefix = this.selectableFiles ? `${cursor} ${checkbox} ${icon} ` : `${cursor} ${icon} `;
			const maxTitleWidth = Math.max(8, width - visibleWidth(expandTabs(prefix)) - 1 - visibleWidth(expandTabs(counts)));
			const titleText = truncateToWidth(expandTabs(section.title), maxTitleWidth, "…");
			const coloredTitle = isSelected ? th.fg("accent", titleText) : th.fg("text", titleText);
			const coloredCounts = colorCounts(counts, th);
			const row = padAnsi(joinLeftRight(`${prefix}${coloredTitle}`, coloredCounts, width), width);
			rows.push(isSelected ? th.bg("selectedBg", row) : row);
		}

		while (rows.length < height) rows.push(" ".repeat(width));
		return rows.slice(0, height);
	}

	private renderPatchRows(width: number, height: number): string[] {
		if (this.rows.length === 0) {
			const th = this.theme as ThemeLike;
			return [padAnsi(th.fg("muted", "No diff."), width), ...Array(Math.max(0, height - 1)).fill(" ".repeat(width))];
		}

		const rows: string[] = [];
		const visible = this.rows.slice(this.scrollRow, this.scrollRow + height);
		for (const row of visible) rows.push(this.renderDisplayRow(row, width));
		while (rows.length < height) rows.push(" ".repeat(width));
		return rows;
	}

	private renderDisplayRow(row: DisplayRow, width: number): string {
		const th = this.theme as ThemeLike;
		if (row.kind === "file") {
			const counts = colorCounts(`${row.additions ? `+${row.additions}` : ""}${row.deletions ? ` -${row.deletions}` : ""}`.trim(), th);
			const title = th.fg("text", th.bold(`▾  ${statusIcon(row.status ?? "modified")} ${row.title ?? "diff"}`));
			return th.bg("toolPendingBg", padAnsi(joinLeftRight(title, counts, width), width));
		}

		if (row.kind === "gap") {
			const label = th.fg("dim", `  ⋯ ${row.note ?? "unchanged lines"}`);
			return th.bg("customMessageBg", padAnsi(label, width));
		}

		if (row.kind === "note") {
			return padAnsi(th.fg("dim", `  • ${row.note ?? "note"}`), width);
		}

		return this.renderCodeRow(row, width);
	}

	private renderCodeRow(row: DisplayRow, width: number): string {
		const th = this.theme as ThemeLike;
		const gutterWidth = width >= 72 ? 10 : 8;
		const lineNumber = row.kind === "delete" ? row.oldLine : row.newLine ?? row.oldLine;
		const sign = row.kind === "add" ? "+" : row.kind === "delete" ? "-" : " ";
		const signColor = row.kind === "add" ? "success" : row.kind === "delete" ? "error" : "dim";
		const gutterText = `${sign} ${lineNumber === undefined ? "" : String(lineNumber)}`.padStart(gutterWidth - 2);
		const gutter = th.fg(signColor, `${gutterText} │ `);
		const contentWidth = Math.max(0, width - gutterWidth);
		const content = truncateToWidth(expandTabs(row.text ?? ""), contentWidth, "…");
		const textColor = row.kind === "context" ? "text" : "text";
		const line = padAnsi(`${gutter}${th.fg(textColor, content)}`, width);
		if (row.kind === "add") return th.bg("toolSuccessBg", line);
		if (row.kind === "delete") return th.bg("toolErrorBg", line);
		return line;
	}

	private frameLine(content: string, width: number): string {
		const th = this.theme as ThemeLike;
		return th.fg("borderMuted", "│") + padAnsi(content, width) + th.fg("borderMuted", "│");
	}

	private moveSelectedFile(delta: number): void {
		if (this.sections.length === 0) return;
		this.selectedFile = clamp(this.selectedFile + delta, 0, this.sections.length - 1);
		this.scrollRow = this.firstRowForSection(this.selectedFile);
	}

	private scrollBy(delta: number): void {
		this.scrollTo(this.scrollRow + delta);
	}

	private scrollTo(row: number): void {
		const maxScroll = Math.max(0, this.rows.length - this.pageSize());
		this.scrollRow = clamp(row, 0, maxScroll);
	}

	private visibleFileStart(height: number): number {
		const maxRows = Math.max(0, height - 1);
		return clamp(this.selectedFile - Math.floor(maxRows / 2), 0, Math.max(0, this.sections.length - maxRows));
	}

	private handleMouseClick(event: MouseClickEvent): void {
		if (event.button !== "left") return;
		const innerWidth = Math.max(2, (this.tui.terminal.columns || 80) - 2);
		const listWidth = this.fileListWidth(innerWidth);
		const bodyHeight = this.pageSize();
		const overFileList = listWidth > 0
			&& event.x >= 2
			&& event.x <= listWidth + 1
			&& event.y >= 4
			&& event.y < 4 + bodyHeight;
		if (!overFileList) return;

		const bodyRow = event.y - 4;
		if (bodyRow <= 0) return;
		const fileIndex = this.visibleFileStart(bodyHeight) + bodyRow - 1;
		if (fileIndex < 0 || fileIndex >= this.sections.length) return;

		this.selectedFile = fileIndex;
		this.scrollRow = this.firstRowForSection(fileIndex);
		this.focus = "files";
		if (this.selectableFiles) this.toggleSelectedFile(fileIndex);
		this.tui.requestRender();
	}

	private handleMouseWheel(event: MouseWheelEvent): void {
		const innerWidth = Math.max(2, (this.tui.terminal.columns || 80) - 2);
		const listWidth = this.fileListWidth(innerWidth);
		const overFileList = listWidth > 0 && event.x <= listWidth + 2 && event.y >= 4 && event.y <= this.overlayHeight() - 3;
		if (overFileList) {
			this.moveSelectedFile(event.direction);
		} else {
			this.scrollBy(event.direction * MOUSE_WHEEL_LINES);
			this.syncSelectedFileToScroll();
		}
		this.tui.requestRender();
	}

	private jumpToChangedLine(delta: 1 | -1): void {
		if (this.sections.length === 0) return;
		const selected = this.sections[this.selectedFile];
		if (!selected) return;

		const current = this.scrollRow;
		const changedRows = this.rows
			.map((row, index) => ({ row, index }))
			.filter(({ row }) => row.sectionIndex === selected.index && (row.kind === "add" || row.kind === "delete"));
		if (changedRows.length === 0) return;

		const next = delta > 0
			? changedRows.find(({ index }) => index > current)
			: [...changedRows].reverse().find(({ index }) => index < current);
		if (!next) return;
		this.scrollTo(next.index);
	}

	private syncSelectedFileToScroll(): void {
		const current = this.rows[this.scrollRow];
		if (current && current.sectionIndex >= 0) this.selectedFile = clamp(current.sectionIndex, 0, Math.max(0, this.sections.length - 1));
	}

	private firstRowForSection(sectionIndex: number): number {
		return Math.max(0, this.rows.findIndex((row) => row.sectionIndex === sectionIndex));
	}

	private toggleSelectedFile(index = this.selectedFile): void {
		const section = this.sections[index];
		if (!section) return;
		if (this.selectedFiles.has(section.index)) this.selectedFiles.delete(section.index);
		else this.selectedFiles.add(section.index);
	}

	private selectAllFiles(): void {
		for (const section of this.sections) this.selectedFiles.add(section.index);
	}

	private clearSelectedFiles(): void {
		this.selectedFiles.clear();
	}

	private selectedFileTitles(): string[] {
		if (!this.selectableFiles) return this.sections.map((section) => section.title);
		return this.sections
			.filter((section) => this.selectedFiles.has(section.index))
			.map((section) => section.title);
	}
}

function parseMouseWheel(data: string): MouseWheelEvent | undefined {
	const sgr = /^\x1b\[<(\d+);(\d+);(\d+)([mM])$/.exec(data);
	if (sgr) {
		if (sgr[4] !== "M") return undefined;
		return mouseWheelFromButtonCode(Number(sgr[1]), Number(sgr[2]), Number(sgr[3]));
	}

	if (data.startsWith("\x1b[M") && data.length >= 6) {
		return mouseWheelFromButtonCode(data.charCodeAt(3) - 32, data.charCodeAt(4) - 32, data.charCodeAt(5) - 32);
	}

	return undefined;
}

function mouseWheelFromButtonCode(code: number, x: number, y: number): MouseWheelEvent | undefined {
	if (!Number.isFinite(code) || !Number.isFinite(x) || !Number.isFinite(y)) return undefined;
	if ((code & 64) === 0) return undefined;
	const button = code & 3;
	if (button === 0) return { direction: -1, x, y };
	if (button === 1) return { direction: 1, x, y };
	return undefined;
}

function parseMouseClick(data: string): MouseClickEvent | undefined {
	const sgr = /^\x1b\[<(\d+);(\d+);(\d+)([mM])$/.exec(data);
	if (sgr) {
		if (sgr[4] !== "M") return undefined;
		return mouseClickFromButtonCode(Number(sgr[1]), Number(sgr[2]), Number(sgr[3]));
	}

	if (data.startsWith("\x1b[M") && data.length >= 6) {
		return mouseClickFromButtonCode(data.charCodeAt(3) - 32, data.charCodeAt(4) - 32, data.charCodeAt(5) - 32);
	}

	return undefined;
}

function mouseClickFromButtonCode(code: number, x: number, y: number): MouseClickEvent | undefined {
	if (!Number.isFinite(code) || !Number.isFinite(x) || !Number.isFinite(y)) return undefined;
	if ((code & 64) !== 0) return undefined;
	if ((code & 32) !== 0) return undefined;
	const button = code & 3;
	if (button === 0) return { button: "left", x, y };
	return undefined;
}

function buildDisplayRows(lines: string[], sections: DiffSection[]): DisplayRow[] {
	const rows: DisplayRow[] = [];

	for (const section of sections) {
		rows.push({
			kind: "file",
			sectionIndex: section.index,
			title: section.title,
			status: section.status,
			additions: section.additions,
			deletions: section.deletions,
		});

		let oldLine = 0;
		let newLine = 0;
		let inHunk = false;
		let seenHunk = false;
		let previousOldEnd = 1;

		for (let i = section.startLine; i <= section.endLine; i++) {
			const line = lines[i] ?? "";
			const hunk = parseHunkHeader(line);
			if (hunk) {
				const hiddenLines = seenHunk ? hunk.oldStart - previousOldEnd : hunk.oldStart - 1;
				if (hiddenLines > 0) {
					rows.push({
						kind: "gap",
						sectionIndex: section.index,
						note: `${hiddenLines} unmodified line${hiddenLines === 1 ? "" : "s"}`,
					});
				}
				oldLine = hunk.oldStart;
				newLine = hunk.newStart;
				previousOldEnd = hunk.oldStart + hunk.oldCount;
				inHunk = true;
				seenHunk = true;
				continue;
			}

			if (!inHunk) {
				const note = normaliseMetadataLine(line);
				if (note) rows.push({ kind: "note", sectionIndex: section.index, note });
				continue;
			}

			if (line.startsWith(" ") || line === "") {
				const text = line.startsWith(" ") ? line.slice(1) : line;
				rows.push({ kind: "context", sectionIndex: section.index, oldLine, newLine, text });
				oldLine++;
				newLine++;
				continue;
			}

			if (line.startsWith("-")) {
				rows.push({ kind: "delete", sectionIndex: section.index, oldLine, text: line.slice(1) });
				oldLine++;
				continue;
			}

			if (line.startsWith("+")) {
				rows.push({ kind: "add", sectionIndex: section.index, newLine, text: line.slice(1) });
				newLine++;
				continue;
			}

			if (line.startsWith("\\")) rows.push({ kind: "note", sectionIndex: section.index, note: line.replace(/^\\\s*/, "") });
		}
	}

	return rows;
}

function parseDiffSections(lines: string[], fallbackTitle: string): DiffSection[] {
	const sections: DiffSection[] = [];
	let current: DiffSection | undefined;

	const startSection = (line: string, index: number) => {
		if (current) {
			current.endLine = index - 1;
			sections.push(current);
		}
		current = {
			index: sections.length,
			title: parseGitDiffTitle(line) ?? fallbackTitle,
			status: "modified",
			startLine: index,
			endLine: index,
			additions: 0,
			deletions: 0,
		};
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		if (line.startsWith("diff --git ")) startSection(line, i);
		if (!current) startSection(line, i);

		if (line.startsWith("new file mode ")) current!.status = "added";
		else if (line.startsWith("deleted file mode ")) current!.status = "deleted";
		else if (line.startsWith("rename from ") || line.startsWith("rename to ")) current!.status = "renamed";
		else if (line.startsWith("+++ ") && line.slice(4).trim() !== "/dev/null") current!.title = cleanDiffPath(line.slice(4));
		else if (line.startsWith("--- ") && current!.title === fallbackTitle && line.slice(4).trim() !== "/dev/null") current!.title = cleanDiffPath(line.slice(4));

		if (line.startsWith("+") && !line.startsWith("+++")) current!.additions++;
		else if (line.startsWith("-") && !line.startsWith("---")) current!.deletions++;
		current!.endLine = i;
	}

	if (current) sections.push(current);
	return sections.length > 0 ? sections : [{ index: 0, title: fallbackTitle, status: "modified", startLine: 0, endLine: Math.max(0, lines.length - 1), additions: 0, deletions: 0 }];
}

function parseGitDiffTitle(line: string): string | undefined {
	const match = /^diff --git\s+a\/(.*?)\s+b\/(.*)$/.exec(line);
	if (!match) return undefined;
	const oldPath = match[1] ?? "";
	const newPath = match[2] ?? "";
	return cleanDiffPath(newPath || oldPath);
}

function parseHunkHeader(line: string): HunkHeader | undefined {
	const match = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@\s?(.*)$/.exec(line);
	if (!match) return undefined;
	return {
		oldStart: Number(match[1]),
		oldCount: Number(match[2] ?? "1"),
		newStart: Number(match[3]),
		newCount: Number(match[4] ?? "1"),
		label: match[5] ?? "",
	};
}

function normaliseMetadataLine(line: string): string | undefined {
	if (line.startsWith("new file mode ")) return "new file";
	if (line.startsWith("deleted file mode ")) return "deleted file";
	if (line.startsWith("old mode ")) return `old mode ${line.slice("old mode ".length)}`;
	if (line.startsWith("new mode ")) return `new mode ${line.slice("new mode ".length)}`;
	if (line.startsWith("rename from ")) return `renamed from ${cleanDiffPath(line.slice("rename from ".length))}`;
	if (line.startsWith("rename to ")) return `renamed to ${cleanDiffPath(line.slice("rename to ".length))}`;
	if (line.startsWith("Binary files ")) return line;
	if (line.startsWith("GIT binary patch")) return "binary patch";
	return undefined;
}

function cleanDiffPath(path: string): string {
	return expandTabs(path.trim()).replace(/^a\//, "").replace(/^b\//, "");
}

function statusIcon(status: DiffSection["status"]): string {
	if (status === "added") return "+";
	if (status === "deleted") return "-";
	if (status === "renamed") return "↷";
	return "•";
}

function colorCounts(counts: string, theme: ThemeLike): string {
	if (!counts) return "";
	return counts
		.split(" ")
		.map((part) => (part.startsWith("+") ? theme.fg("success", part) : part.startsWith("-") ? theme.fg("error", part) : part))
		.join(" ");
}

function joinLeftRight(left: string, right: string, width: number): string {
	if (width <= 0) return "";
	const cleanLeft = expandTabs(left);
	const cleanRight = expandTabs(right);
	const leftWidth = visibleWidth(cleanLeft);
	const rightWidth = visibleWidth(cleanRight);
	if (rightWidth >= width) return truncateToWidth(cleanLeft || cleanRight, width, "…");
	if (leftWidth + rightWidth + 1 <= width) {
		return cleanLeft + " ".repeat(width - leftWidth - rightWidth) + cleanRight;
	}
	const availableLeft = Math.max(0, width - rightWidth - 1);
	if (availableLeft > 4) return truncateToWidth(cleanLeft, availableLeft, "…") + " " + cleanRight;
	return truncateToWidth(cleanLeft, width, "…");
}

function padAnsi(text: string, width: number): string {
	if (width <= 0) return "";
	const clipped = truncateToWidth(expandTabs(text), width, "…");
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function expandTabs(text: string): string {
	return text.replace(/\t/g, "    ");
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}
