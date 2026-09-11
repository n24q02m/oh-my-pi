/**
 * EF1-R2 remainder: discovery-path rebuild coverage. The explicit
 * `supportsConfigurationUpdate` boolean must survive registry-level rebuilds —
 * online provider discovery (`/models` refresh) and offline full-registry
 * refresh — with the discovery/refresh precedence locked at the registry API
 * surface, not just the config patch helpers.
 */
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { FetchImpl } from "@oh-my-pi/pi-ai";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { AuthStorage, SqliteAuthCredentialStore } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { removeSyncWithRetries, Snowflake } from "@oh-my-pi/pi-utils";

describe("ModelRegistry supportsConfigurationUpdate discovery/refresh precedence (EF1-R2)", () => {
	let tempDir: string;
	let modelsJsonPath: string;
	let authStorage: AuthStorage;

	beforeEach(async () => {
		tempDir = path.join(os.tmpdir(), `pi-test-cap-registry-${Snowflake.next()}`);
		fs.mkdirSync(tempDir, { recursive: true });
		modelsJsonPath = path.join(tempDir, "models.json");
		authStorage = new AuthStorage(new SqliteAuthCredentialStore(new Database(":memory:")));
	});

	afterEach(() => {
		authStorage.close();
		removeSyncWithRetries(tempDir);
	});

	function writeRawModelsJson(providers: Record<string, unknown>) {
		fs.writeFileSync(modelsJsonPath, JSON.stringify({ providers }));
	}

	function mockOpenAiCompatibleModels(url: string, modelIds: string[]): FetchImpl {
		return async input => {
			const requestUrl = String(input);
			if (requestUrl === url) {
				return new Response(JSON.stringify({ data: modelIds.map(id => ({ id })) }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}
			throw new Error(`Unexpected URL: ${requestUrl}`);
		};
	}

	function capabilityProbe(discoveryUrl: string, providers: Record<string, unknown>): ModelRegistry {
		writeRawModelsJson(providers);
		const fetchMock = mockOpenAiCompatibleModels(discoveryUrl, [
			"cap-probe-model",
			"cap-true-model",
			"cap-absent-model",
		]);
		return new ModelRegistry(authStorage, modelsJsonPath, { fetch: fetchMock });
	}

	it("explicit false on a provider model definition survives online discovery refresh", async () => {
		const registry = capabilityProbe("https://cap-proxy.example.com/v1/models", {
			openai: {
				baseUrl: "https://cap-proxy.example.com/v1",
				apiKey: "TEST_KEY",
				api: "openai-responses",
				models: [{ id: "cap-probe-model", supportsConfigurationUpdate: false }],
			},
		});
		expect(registry.find("openai", "cap-probe-model")?.supportsConfigurationUpdate).toBe(false);

		// Discovery returns the same id without the flag; the rebuild must keep
		// the configured explicit false instead of clobbering it with undefined.
		await registry.refreshProvider("openai", "online");
		// The online pass really hit the provider discovery endpoint (the mock
		// throws on any other URL, so a green run means the refresh fetched it).
		expect(registry.find("openai", "cap-probe-model")?.supportsConfigurationUpdate).toBe(false);
	});

	it("modelOverrides explicit false and true survive online discovery refresh; absent stays undefined", async () => {
		const registry = capabilityProbe("https://cap-override.example.com/v1/models", {
			openai: {
				baseUrl: "https://cap-override.example.com/v1",
				apiKey: "TEST_KEY",
				api: "openai-responses",
				models: [{ id: "cap-probe-model" }, { id: "cap-true-model" }, { id: "cap-absent-model" }],
				modelOverrides: {
					"cap-probe-model": { supportsConfigurationUpdate: false },
					"cap-true-model": { supportsConfigurationUpdate: true },
				},
			},
		});
		expect(registry.find("openai", "cap-probe-model")?.supportsConfigurationUpdate).toBe(false);
		expect(registry.find("openai", "cap-true-model")?.supportsConfigurationUpdate).toBe(true);
		expect(registry.find("openai", "cap-absent-model")?.supportsConfigurationUpdate).toBeUndefined();

		await registry.refreshProvider("openai", "online");

		expect(registry.find("openai", "cap-probe-model")?.supportsConfigurationUpdate).toBe(false);
		expect(registry.find("openai", "cap-true-model")?.supportsConfigurationUpdate).toBe(true);
		expect(registry.find("openai", "cap-absent-model")?.supportsConfigurationUpdate).toBeUndefined();
	});

	it("explicit false persists through a full offline refresh that reloads models.json", async () => {
		const registry = capabilityProbe("https://cap-offline.example.com/v1/models", {
			openai: {
				baseUrl: "https://cap-offline.example.com/v1",
				apiKey: "TEST_KEY",
				api: "openai-responses",
				models: [{ id: "cap-probe-model", supportsConfigurationUpdate: false }],
			},
		});
		expect(registry.find("openai", "cap-probe-model")?.supportsConfigurationUpdate).toBe(false);

		await registry.refresh("offline");
		expect(registry.find("openai", "cap-probe-model")?.supportsConfigurationUpdate).toBe(false);
	});
});
