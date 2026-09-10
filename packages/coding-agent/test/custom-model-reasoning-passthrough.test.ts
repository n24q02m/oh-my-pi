import { describe, expect, it } from "bun:test";
import {
	buildCustomModelOverlay,
	type CustomModelDefinitionLike,
	type CustomModelOverlay,
	finalizeCustomModel,
} from "@oh-my-pi/pi-coding-agent/config/custom-models";

/**
 * EF1-R2 seam: the models-config `reasoning` boolean override must keep its
 * explicit-false passthrough — `reasoning: false` on a definition whose bundled
 * reference is reasoning-capable (or which would otherwise inherit defaults)
 * has to resolve to a non-reasoning model, never fall through to inference.
 */
describe("custom model reasoning boolean passthrough (EF1-R2)", () => {
	const provider = {
		name: "test-provider",
		api: "anthropic-messages" as const,
		baseUrl: "https://example.invalid",
	};

	function definition(reasoning: boolean | undefined, id = "claude-sonnet-4-6"): CustomModelDefinitionLike {
		return { id, reasoning } as CustomModelDefinitionLike;
	}

	function overlayFor(modelDef: CustomModelDefinitionLike): CustomModelOverlay {
		const overlay = buildCustomModelOverlay(
			provider.name,
			provider.baseUrl,
			provider.api,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			modelDef,
		);
		if (!overlay) throw new Error("Expected custom model overlay to build");
		return overlay;
	}

	it("explicit false beats a reasoning-capable bundled reference", () => {
		const model = finalizeCustomModel(overlayFor(definition(false)), { useDefaults: true });
		expect(model.reasoning).toBe(false);
	});

	it("explicit true stays true and absent reasoning inherits the reference", () => {
		const forced = finalizeCustomModel(overlayFor(definition(true)), { useDefaults: true });
		expect(forced.reasoning).toBe(true);

		const inherited = finalizeCustomModel(overlayFor(definition(undefined)), { useDefaults: true });
		expect(inherited.reasoning).toBe(true);
	});

	it("unknown ids with explicit false keep false under defaults instead of falling back to undefined", () => {
		const model = finalizeCustomModel(overlayFor(definition(false, "totally-unknown-model")), {
			useDefaults: true,
		});
		expect(model.reasoning).toBe(false);
	});
});
