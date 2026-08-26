import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { DIFF_USAGE, parseDiffCommandArgs } from "./src/args";
import { createChangeRequestPrompt, createDiffMessage, createReviewPrompt, overlayDiffLimits } from "./src/diff-message";
import { showDiffOverlay, type DiffOverlayResult } from "./src/overlay";
import { renderDiffMessage } from "./src/render";
import { resolveDiffInput, type ResolvedDiff } from "./src/source";

export default function piDiffViewerExtension(pi: ExtensionAPI) {
	pi.registerMessageRenderer("pi-diff-viewer", renderDiffMessage);

	pi.registerCommand("diff", {
		description: "Open a terminal diff viewer (usage: /diff [--staged] [path] | /diff git <args>)",
		getArgumentCompletions: (prefix) => {
			const items = [
				{ value: "--staged", label: "--staged", description: "Show staged changes" },
				{ value: "--ask", label: "--ask", description: "Select files and ask the agent to review" },
				{ value: "--max-lines", label: "--max-lines", description: "Maximum stored diff lines" },
				{ value: "--no-overlay", label: "--no-overlay", description: "Keep the diff inline" },
				{ value: "git", label: "git", description: "Pass following args to git diff" },
				{ value: "--help", label: "--help", description: "Show usage" },
			];
			const filtered = items.filter((item) => item.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const parsed = parseDiffCommandArgs(args);
			if (!parsed.ok) {
				ctx.ui.notify(parsed.error, "warning");
				return;
			}

			if (parsed.options.help) {
				showHelp(pi);
				return;
			}

			const resolved = await resolveDiffInput(pi, ctx, parsed.options);
			if (!resolved.ok) {
				ctx.ui.notify(`Could not resolve diff: ${resolved.error}`, "error");
				return;
			}

			if (!resolved.value.diff.trim()) {
				ctx.ui.notify(`No diff found for ${resolved.value.sourceLabel}`, "info");
				return;
			}

			const useOverlay = ctx.hasUI && !parsed.options.noOverlay;
			const overlayLimits = overlayDiffLimits(parsed.options);
			const message = useOverlay
				? createDiffMessage(resolved.value, { ...parsed.options, maxLines: overlayLimits.maxLines }, overlayLimits)
				: createDiffMessage(resolved.value, parsed.options);
			let overlayResult: DiffOverlayResult | undefined;
			if (useOverlay) {
				overlayResult = await showDiffOverlay(ctx, message.details, { selectableFiles: parsed.options.ask });
			} else {
				pi.sendMessage({
					customType: "pi-diff-viewer",
					content: message.content,
					display: true,
					details: message.details,
				});
			}

			if (parsed.options.ask) {
				await runReviewFlow(pi, ctx, resolved.value, overlayResult, useOverlay);
			}
		},
	});

	pi.registerCommand("review-diff", {
		description: "Render a diff and ask the agent to review it",
		getArgumentCompletions: (prefix) => {
			const items = [
				{ value: "--staged", label: "--staged", description: "Review staged changes" },
				{ value: "--no-overlay", label: "--no-overlay", description: "Keep the diff inline" },
				{ value: "git", label: "git", description: "Pass following args to git diff" },
				{ value: "--help", label: "--help", description: "Show usage" },
			];
			const filtered = items.filter((item) => item.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const parsed = parseDiffCommandArgs(args, { ask: true });
			if (!parsed.ok) {
				ctx.ui.notify(parsed.error, "warning");
				return;
			}

			if (parsed.options.help) {
				showHelp(pi);
				return;
			}

			const resolved = await resolveDiffInput(pi, ctx, parsed.options);
			if (!resolved.ok) {
				ctx.ui.notify(`Could not resolve diff: ${resolved.error}`, "error");
				return;
			}

			if (!resolved.value.diff.trim()) {
				ctx.ui.notify(`No diff found for ${resolved.value.sourceLabel}`, "info");
				return;
			}

			const useOverlay = ctx.hasUI && !parsed.options.noOverlay;
			const overlayLimits = overlayDiffLimits(parsed.options);
			const message = useOverlay
				? createDiffMessage(resolved.value, { ...parsed.options, maxLines: overlayLimits.maxLines }, overlayLimits)
				: createDiffMessage(resolved.value, parsed.options);
			let overlayResult: DiffOverlayResult | undefined;
			if (useOverlay) {
				overlayResult = await showDiffOverlay(ctx, message.details, { selectableFiles: true });
			} else {
				pi.sendMessage({
					customType: "pi-diff-viewer",
					content: message.content,
					display: true,
					details: message.details,
				});
			}

			await runReviewFlow(pi, ctx, resolved.value, overlayResult, useOverlay);
		},
	});
}

function showHelp(pi: ExtensionAPI) {
	pi.sendMessage({
		customType: "pi-diff-viewer",
		content: "/diff usage",
		display: true,
		details: { kind: "help", help: DIFF_USAGE },
	});
}

async function runReviewFlow(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	resolved: ResolvedDiff,
	overlayResult: DiffOverlayResult | undefined,
	usedOverlay: boolean,
): Promise<void> {
	const selectedFiles = overlayResult?.selectedFiles;
	if (selectedFiles && selectedFiles.length === 0) {
		ctx.ui.notify("No files selected for review. Re-run /review-diff and select at least one file.", "warning");
		return;
	}

	if (!usedOverlay || overlayResult?.action === "review") {
		sendUserPrompt(pi, ctx, createReviewPrompt(resolved, { selectedFiles }));
		return;
	}

	const instructions = await ctx.ui.editor(
		"Do you want to change anything? Tell the agent what to change, or leave empty to continue review.",
	);
	if (instructions === undefined) {
		ctx.ui.notify("Diff review cancelled", "info");
		return;
	}

	const trimmed = instructions.trim();
	const prompt = trimmed
		? createChangeRequestPrompt(resolved, trimmed, { selectedFiles })
		: createReviewPrompt(resolved, { selectedFiles });
	sendUserPrompt(pi, ctx, prompt);
}

function sendUserPrompt(pi: ExtensionAPI, ctx: { isIdle(): boolean; ui: { notify(message: string, level: "info" | "warning" | "error"): void } }, prompt: string) {
	if (ctx.isIdle()) {
		pi.sendUserMessage(prompt);
		return;
	}

	pi.sendUserMessage(prompt, { deliverAs: "followUp" });
	ctx.ui.notify("Diff review queued as a follow-up message", "info");
}
