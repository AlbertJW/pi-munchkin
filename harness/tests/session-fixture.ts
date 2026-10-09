// Shared offline model runtime for real-AgentSession tests: in-memory credentials,
// no catalog refresh, no network. Pi SDK construction lives here so a Pi upgrade
// is fixed in one place.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, type Model } from "@earendil-works/pi-ai";

export async function scriptedModelRuntime(model: Model<any>): Promise<ModelRuntime> {
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false,
		modelsStorePath: join(mkdtempSync(join(tmpdir(), "pi-fixture-models-")), "models-cache.json"),
	});
	runtime.registerProvider(model.provider, { api: model.api, apiKey: "scripted-no-network", baseUrl: model.baseUrl, models: [model as any] });
	return runtime;
}
