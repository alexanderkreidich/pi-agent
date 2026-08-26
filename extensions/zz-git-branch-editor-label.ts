import { spawnSync } from "node:child_process";
import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, KeybindingsManager, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const FALLBACK_LABEL = "no git";
const REFRESH_INTERVAL_MS = 2_000;

function cleanLabel(value: string | undefined): string | undefined {
	const label = value?.replace(/[\r\n\t\x00-\x1f\x7f]/g, " ").trim();
	return label && label.length > 0 ? label : undefined;
}

function renderLabeledBorder(label: string, width: number, color: (text: string) => string): string {
	if (width <= 0) return "";
	if (width === 1) return color("─");

	const safeLabel = truncateToWidth(label, Math.max(0, width - 4), "…");
	const prefix = `─ ${safeLabel} `;
	const line = prefix + "─".repeat(Math.max(0, width - visibleWidth(prefix)));
	return color(truncateToWidth(line, width, ""));
}

function readCurrentBranchSync(cwd: string): string | undefined {
	const current = spawnSync("git", ["--no-optional-locks", "branch", "--show-current"], {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
		timeout: 1_000,
	});
	const branch = cleanLabel(current.stdout || undefined);
	if (branch) return branch;

	const detached = spawnSync("git", ["--no-optional-locks", "rev-parse", "--short", "HEAD"], {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
		timeout: 1_000,
	});
	const sha = cleanLabel(detached.stdout || undefined);
	return sha ? `detached:${sha}` : undefined;
}

export default function gitBranchEditorLabel(pi: ExtensionAPI) {
	let refreshTimer: ReturnType<typeof setInterval> | undefined;
	let activeTui: TUI | undefined;
	let branchLabel: string | undefined;

	const requestRender = () => activeTui?.requestRender();

	const stopRefresh = () => {
		if (refreshTimer) {
			clearInterval(refreshTimer);
			refreshTimer = undefined;
		}
		activeTui = undefined;
		branchLabel = undefined;
	};

	pi.on("session_shutdown", stopRefresh);

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		stopRefresh();
		branchLabel = readCurrentBranchSync(ctx.cwd);

		let disposed = false;
		let refreshInFlight = false;

		const refreshBranch = async () => {
			if (disposed || refreshInFlight) return;
			refreshInFlight = true;
			try {
				const current = await pi.exec("git", ["--no-optional-locks", "branch", "--show-current"], { cwd: ctx.cwd, timeout: 5_000 });
				let next = cleanLabel(current.stdout);

				if (!next) {
					const detached = await pi.exec("git", ["--no-optional-locks", "rev-parse", "--short", "HEAD"], { cwd: ctx.cwd, timeout: 5_000 });
					const sha = cleanLabel(detached.stdout);
					next = sha ? `detached:${sha}` : undefined;
				}

				if (!disposed && branchLabel !== next) {
					branchLabel = next;
					requestRender();
				}
			} catch {
				if (!disposed && branchLabel !== undefined) {
					branchLabel = undefined;
					requestRender();
				}
			} finally {
				refreshInFlight = false;
			}
		};

		void refreshBranch();
		refreshTimer = setInterval(() => void refreshBranch(), REFRESH_INTERVAL_MS);

		class GitBranchLabelEditor extends CustomEditor {
			constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
				super(tui, theme, keybindings);
				activeTui = tui;
			}

			dispose(): void {
				disposed = true;
			}

			render(width: number): string[] {
				const lines = super.render(width);
				if (lines.length === 0) return lines;

				lines[0] = renderLabeledBorder(branchLabel ?? FALLBACK_LABEL, width, this.borderColor);
				return lines;
			}
		}

		ctx.ui.setEditorComponent((tui, theme, keybindings) => new GitBranchLabelEditor(tui, theme, keybindings));
	});
}
