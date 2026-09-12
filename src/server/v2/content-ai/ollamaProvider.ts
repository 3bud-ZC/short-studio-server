import axios from "axios";
import { LocalContentAIProvider } from "./localProvider";
import type {
  ContentAIProvider,
  GenerateSpecParams,
  PromptRewriteResult,
  ProviderValidationResult,
  SpecReviewResult,
} from "./types";
import type { ProductionSceneSpec, ProductionSpec } from "../../../types/productionSpec";
import { validateProductionSpec } from "../../../types/productionSpec";
import { inventsUngroundedClaim } from "../creative/ctaPolicy";
import { containsRawPromptLeak } from "../quality/professionalVisualQuality";
import { logger } from "../../../logger";
import { buildPromptIntentContract } from "./promptIntentContract";
import { enforceAndRepairPromptFidelity } from "../quality/promptFidelityGate";

function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Local LLM response did not include a JSON object.");
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * The deterministic baseline already ran the full truth-safety pipeline
 * (resolveCtaProvenance, enforcePromptTruthSafety, raw-prompt-leak guard) on
 * its own scenes. Nothing re-checks the LLM's "improved" hook/narration/CTA/
 * scene intent after that, and the system prompt above only ASKS it not to
 * invent claims - it does not enforce that. This re-applies the same checks
 * per scene and per-field reverts to the (already safe) baseline value
 * whenever the LLM's version fails them, rather than discarding the whole
 * LLM response for one bad field.
 */
function enforceTruthSafetyOnLlmScenes(
  llmScenes: unknown,
  baselineScenes: ProductionSceneSpec[],
  prompt: string,
): ProductionSceneSpec[] {
  if (!Array.isArray(llmScenes)) return baselineScenes;
  return baselineScenes.map((baselineScene, index) => {
    const candidate = llmScenes[index];
    if (!candidate || typeof candidate !== "object") return baselineScene;
    const merged: ProductionSceneSpec = { ...baselineScene, ...(candidate as Partial<ProductionSceneSpec>) };
    const narration = String(merged.narration || "");
    const onScreenText = merged.onScreenText ? String(merged.onScreenText) : undefined;
    const narrationUnsafe = inventsUngroundedClaim(narration, prompt) || containsRawPromptLeak(prompt, narration);
    const onScreenUnsafe = onScreenText
      ? inventsUngroundedClaim(onScreenText, prompt) || containsRawPromptLeak(prompt, onScreenText)
      : false;
    return {
      ...merged,
      narration: narrationUnsafe ? baselineScene.narration : merged.narration,
      onScreenText: onScreenUnsafe ? baselineScene.onScreenText : merged.onScreenText,
      // Duration and visual routing stay under the deterministic planner's
      // control regardless of what the LLM proposed - those are timeline/
      // provider-routing decisions, not creative copy.
      durationSeconds: baselineScene.durationSeconds,
      purpose: baselineScene.purpose,
      sceneIndex: baselineScene.sceneIndex,
    };
  });
}

export class OllamaContentAIProvider implements ContentAIProvider {
  public readonly id = "ollama";
  public readonly displayName = "Ollama Local LLM Creative Director";
  public readonly category = "content_ai" as const;
  private fallback = new LocalContentAIProvider();

  constructor(
    private baseUrl = process.env.OLLAMA_BASE_URL || "",
    private model = process.env.OLLAMA_MODEL || "qwen2.5:7b-instruct",
  ) {}

  public get isConfigured(): boolean {
    return Boolean(this.baseUrl);
  }

  public async generateProductionSpec(params: GenerateSpecParams): Promise<ProductionSpec> {
    if (!this.isConfigured) return this.fallback.generateProductionSpec(params);
    // The baseline always runs first and is returned as-is on any failure
    // below (section 4: "do not block the product" - a configured-but-
    // unreachable Ollama endpoint, a malformed response, or a schema
    // mismatch must degrade to the deterministic planner's output, not fail
    // the job outright, which the previous version - no try/catch around
    // the live call - would have done).
    const baseline = await this.fallback.generateProductionSpec(params);
    const contract = buildPromptIntentContract(params.prompt, {
      language: params.language === "ar" ? "ar" : params.language === "en" ? "en" : "auto",
      dialect: params.dialect,
      durationSeconds: params.durationSeconds || params.requestedDurationSeconds,
      contentStyle: params.contentStyle,
    });
    try {
      const system = [
        "You are ABUD Shorts Engine Creative Director.",
        "Return only valid JSON matching the provided ProductionSpec object shape.",
        "User prompt is authoritative. Preserve every literal user requirement in the promptIntentContract.",
        "Negative instructions are prohibitions, never positive instructions.",
        "Preserve durationSeconds, language, dialect, aspectRatio, quality, productionMode, visualMode, voiceProvider, and voiceId exactly.",
        "Improve hook, spoken narration, CTA when explicitly grounded, scene intent, precise concrete stock search terms, motion intent, and editing rhythm.",
        "Never invent a price, discount, phone number, WhatsApp number, testimonial, statistic, or claim that is not grounded in the customer's own prompt.",
        "Stock search terms must be concrete visual subjects for each exact scene, never generic mood words.",
        "For Egyptian Arabic, use conversational spoken Egyptian Arabic, not translated MSA.",
        "Do not include subjective quality scores.",
      ].join(" ");
      const response = await axios.post(
        `${this.baseUrl.replace(/\/$/, "")}/api/generate`,
        {
          model: this.model,
          stream: false,
          system,
          prompt: JSON.stringify({ params, promptIntentContract: contract, baseline }),
          format: "json",
        },
        { timeout: Number(process.env.OLLAMA_TIMEOUT_MS || 45000) },
      );
      const raw = typeof response.data?.response === "string" ? response.data.response : JSON.stringify(response.data);
      const parsed = extractJsonObject(raw) as Record<string, unknown>;
      // Truth safety is re-applied per scene/field below rather than trusted
      // from the LLM - see enforceTruthSafetyOnLlmScenes.
      const safeScenes = enforceTruthSafetyOnLlmScenes(parsed.scenes, baseline.scenes, params.prompt);
      const llmCtaText = (parsed.cta as any)?.text;
      const ctaSafe = typeof llmCtaText === "string" &&
        !inventsUngroundedClaim(llmCtaText, params.prompt) &&
        !containsRawPromptLeak(params.prompt, llmCtaText);
      // Only the fields the system prompt actually asks the LLM to improve
      // are taken from its response; every structural field (id, userPrompt,
      // brandKit, captionStyle, ...) comes from the baseline regardless of
      // what the LLM echoed back. Requiring an LLM to faithfully round-trip
      // an entire ProductionSpec object just to change a few lines of copy
      // is unnecessary and fragile - a response missing or mistyping any of
      // those structural fields used to fail `validateProductionSpec`
      // entirely and silently discard an otherwise-good improvement.
      const spec = validateProductionSpec({
        ...baseline,
        title: typeof parsed.title === "string" && !containsRawPromptLeak(params.prompt, parsed.title) ? parsed.title : baseline.title,
        scenes: safeScenes,
        // The CTA channel/contact is a provenance decision baked into
        // `baseline.cta` by resolveCtaProvenance - never let the LLM invent
        // a different contact channel, only allow it to reword the safe text.
        cta: {
          ...baseline.cta,
          text: ctaSafe ? llmCtaText : baseline.cta?.text,
        },
        contact: baseline.contact,
        durationSeconds: baseline.durationSeconds,
        language: baseline.language,
        dialect: baseline.dialect,
        aspectRatio: baseline.aspectRatio,
        quality: baseline.quality,
        productionMode: baseline.productionMode,
        visualMode: baseline.visualMode,
        voiceProvider: baseline.voiceProvider,
        voiceId: baseline.voiceId,
        metadata: {
          ...(baseline.metadata || {}),
          planner: "OllamaContentAIProvider",
          contentProvider: "ollama",
          plannerModel: this.model,
          model: this.model,
          fallbackPlanner: "LocalContentAIProvider",
          contentProvenance: "MODEL_GENERATED",
          contentConfidence: "high",
        },
      });
      return enforceAndRepairPromptFidelity(spec, contract).spec;
    } catch (error) {
      logger.warn(
        { err: error instanceof Error ? error.message : String(error), model: this.model },
        "Ollama content generation failed; using the deterministic baseline instead",
      );
      return baseline;
    }
  }

  public async rewritePrompt(
    prompt: string,
    context?: { language?: any; dialect?: any; contentStyle?: any },
  ): Promise<PromptRewriteResult> {
    return this.fallback.rewritePrompt(prompt, context);
  }

  public async reviewSpec(spec: ProductionSpec): Promise<SpecReviewResult> {
    return this.fallback.reviewSpec(spec);
  }

  public async validate(): Promise<ProviderValidationResult> {
    const checkedAt = new Date().toISOString();
    if (!this.isConfigured) {
      return {
        provider: "Ollama Local LLM",
        configured: false,
        healthy: false,
        status: "not_configured",
        message: "OLLAMA_BASE_URL is not configured. Deterministic Local AI remains active.",
        checkedAt,
      };
    }
    const started = Date.now();
    try {
      await axios.get(`${this.baseUrl.replace(/\/$/, "")}/api/tags`, { timeout: 5000 });
      return {
        provider: "Ollama Local LLM",
        configured: true,
        healthy: true,
        status: "healthy",
        message: `Ollama endpoint is reachable. Requested model: ${this.model}.`,
        checkedAt,
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      return {
        provider: "Ollama Local LLM",
        configured: true,
        healthy: false,
        status: "provider_unavailable",
        message: error instanceof Error ? error.message : "Ollama validation failed.",
        checkedAt,
        latencyMs: Date.now() - started,
      };
    }
  }
}
