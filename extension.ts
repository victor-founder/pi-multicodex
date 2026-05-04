import type {
	ExtensionAPI,
	ExtensionContext,
	SessionStartEvent,
} from "@mariozechner/pi-coding-agent";
import { AccountManager } from "./account-manager";
import { registerCommands } from "./commands";
import { handleNewSessionSwitch, handleSessionStart } from "./hooks";
import { buildMulticodexProviderConfig, PROVIDER_ID } from "./provider";
import { createUsageStatusController } from "./status";

export default function multicodexExtension(pi: ExtensionAPI) {
	const accountManager = new AccountManager();
	const statusController = createUsageStatusController(accountManager);
	let lastContext: ExtensionContext | undefined;

	accountManager.setWarningHandler((message) => {
		if (lastContext) {
			lastContext.ui.notify(message, "warning");
		}
	});

	pi.registerProvider(
		PROVIDER_ID,
		buildMulticodexProviderConfig(accountManager),
	);

	registerCommands(pi, accountManager, statusController);

	pi.on("session_start", (event: SessionStartEvent, ctx: ExtensionContext) => {
		lastContext = ctx;
		accountManager.resetSessionWarnings();
		if (event.reason === "new") {
			handleNewSessionSwitch(accountManager, (msg) =>
				ctx.ui.notify(msg, "warning"),
			);
		} else {
			handleSessionStart(accountManager, (msg) =>
				ctx.ui.notify(msg, "warning"),
			);
		}
		statusController.startAutoRefresh();
		void (async () => {
			await statusController.loadPreferences(ctx);
			await statusController.refreshFor(ctx);
		})();
	});

	pi.on("turn_end", (_event: unknown, ctx: ExtensionContext) => {
		lastContext = ctx;
		void statusController.refreshFor(ctx);
	});

	pi.on("model_select", (_event: unknown, ctx: ExtensionContext) => {
		lastContext = ctx;
		statusController.scheduleModelSelectRefresh(ctx);
	});

	pi.on("session_shutdown", (_event: unknown, ctx: ExtensionContext) => {
		statusController.stopAutoRefresh(ctx);
	});
}
