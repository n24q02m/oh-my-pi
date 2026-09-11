import { describe, expect, it } from "bun:test";
import {
	buildCustomModelOverlay,
	type CustomModelDefinitionLike,
	type CustomModelOverlay,
	finalizeCustomModel,
} from "@oh-my-pi/pi-coding-agent/config/custom-models";
import { applyModelOverride } from "@oh-my-pi/pi-coding-agent/config/model-patch";
import { getModelsConfigSchema } from "@oh-my-pi/pi-coding-agent/config/models-config-schema-bundle";

/**
 * EF1-R2 seam: the models-config `supportsConfigurationUpdate` boolean must
 * keep its explicit-false passthrough. Spec EF1-R2: declare and document the
 * boolean, reject wrong types, and preserve explicit `false` through
 * provider/model overrides, conditional compat, and registry rebuilds —
 * testing the config -> registry -> serializer path, not just the schema.
 * `false` is the only unsupported signal; `true`/`undefined` mean callers may
 * attempt configuration updates.
 */
describe("custom model supportsConfigurationUpdate passthrough (EF1-R2)", () => {
	const provider = {
		name: "test-provider",
		api: "anthropic-messages" as const,
		baseUrl: "https://example.invalid",
	};

	function definition(
		supportsConfigurationUpdate: boolean | undefined,
		id = "claude-sonnet-4-6",
	): CustomModelDefinitionLike {
		return { id, supportsConfigurationUpdate } as CustomModelDefinitionLike;
	}

	function overlayFor(
		modelDef: CustomModelDefinitionLike,
		providerCompat?: CustomModelOverlay["compat"],
	): CustomModelOverlay {
		const overlay = buildCustomModelOverlay(
			provider.name,
			provider.baseUrl,
			provider.api,
			undefined,
			undefined,
			undefined,
			providerCompat,
			undefined,
			undefined,
			modelDef,
		);
		if (!overlay) throw new Error("Expected custom model overlay to build");
		return overlay;
	}

	it("explicit false beats the bundled reference through finalize (config -> registry -> built model)", () => {
		const model = finalizeCustomModel(overlayFor(definition(false)), { useDefaults: true });
		expect(model.supportsConfigurationUpdate).toBe(false);
	});

	it("explicit true stays true and absent inherits the reference (undefined, never coerced)", () => {
		const forced = finalizeCustomModel(overlayFor(definition(true)), { useDefaults: true });
		expect(forced.supportsConfigurationUpdate).toBe(true);

		const inherited = finalizeCustomModel(overlayFor(definition(undefined)), { useDefaults: true });
		expect(inherited.supportsConfigurationUpdate).toBeUndefined();
	});

	it("explicit false survives with provider compat present (conditional compat rebuilds)", () => {
		const model = finalizeCustomModel(overlayFor(definition(false), { supportsStore: true }), {
			useDefaults: true,
		});
		expect(model.supportsConfigurationUpdate).toBe(false);
		expect(model.compatConfig).toBeDefined();
	});

	it("model overrides preserve explicit false over a truthy base (applyModelPatch merge)", () => {
		const base = finalizeCustomModel(overlayFor(definition(true)), { useDefaults: true });
		expect(base.supportsConfigurationUpdate).toBe(true);

		const overridden = applyModelOverride(base, { supportsConfigurationUpdate: false });
		expect(overridden.supportsConfigurationUpdate).toBe(false);

		const truthy = applyModelOverride(base, { supportsConfigurationUpdate: true });
		expect(truthy.supportsConfigurationUpdate).toBe(true);

		const untouched = applyModelOverride(base, {});
		expect(untouched.supportsConfigurationUpdate).toBe(true);
	});

	it("unknown ids with explicit false keep false under defaults instead of falling back to undefined", () => {
		const model = finalizeCustomModel(overlayFor(definition(false, "totally-unknown-model")), {
			useDefaults: true,
		});
		expect(model.supportsConfigurationUpdate).toBe(false);
	});

	it("schema rejects wrong types for the boolean (declare + reject wrong types)", () => {
		const schema = getModelsConfigSchema();
		const config: {
			providers: Record<
				string,
				{ baseUrl: string; api: string; models: Array<{ id: string; supportsConfigurationUpdate?: unknown }> }
			>;
		} = {
			providers: {
				[provider.name]: {
					baseUrl: provider.baseUrl,
					api: provider.api,
					models: [{ id: "some-model", supportsConfigurationUpdate: "yes" }],
				},
			},
		};
		const stringResult = schema(config);
		expect(String(stringResult)).toMatch(/supportsConfigurationUpdate/);
		expect(String(stringResult)).toMatch(/boolean/);

		const numeric = structuredClone(config);
		numeric.providers[provider.name].models[0].supportsConfigurationUpdate = 1;
		const numericResult = schema(numeric);
		expect(String(numericResult)).toMatch(/supportsConfigurationUpdate/);
	});
});
