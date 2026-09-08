import fs from "fs-extra";
import path from "path";
import { describe, expect, it } from "vitest";

import {
  ALIGNMENT_CONFIDENCE_THRESHOLD,
  alignmentMatchesText,
  isAlignmentConfident,
  mapAlignmentToCaptionTokens,
  normalizeForMatch,
  parseElevenLabsAlignment,
  tokenizeWithSpans,
} from "./voice-providers/elevenLabsAlignment";
import {
  buildArabicAss,
  chunkIntoPhrases,
  escapeAssText,
  fitFontSize,
  formatAssTime,
  measureTextWidth,
  renderArabicCaptions,
  toAssColour,
  wrapWords,
} from "./captions/arabicCaptionRendererV3";
import { detectBrokenArabicShaping, runCaptionQa } from "./captions/captionQa";
import {
  CAPTION_FONTS,
  CAPTION_STYLES,
  CAPTION_STYLE_IDS,
  resolveCaptionStyle,
} from "./captions/captionStyles";
import {
  buildEditDecisionList,
  intentForPurpose,
  nearestBeat,
  shotCountForScene,
  sourceTypeDiversity,
  transitionBetween,
  type VisualShot,
} from "./editing/editDecisionList";
import { PixabayProvider } from "./stock-providers/pixabayProvider";
import {
  dedupeCandidates,
  scoreCandidateQuality,
  scoreCandidateSemantics,
  StockProviderRegistry,
  type ScoredCandidate,
} from "./stock-providers/stockProviderRegistry";
import { MOCKUP_TEMPLATE_IDS, mockupForIntent, renderMockupSvg } from "./mockups/websiteMockupRenderer";
import { selectBestWindow, type SceneDetectionResult } from "./quality/sceneDetectionAdapter";
import {
  applyVisualIntentPolicy,
  looksLikeCodeFootageTerm,
  narrationIsEngineering,
} from "./media-intelligence/visualIntentPolicy";
import {
  externalCostLabel,
  isDisplayableAmount,
  isFreeCost,
  isUsageBasedCost,
  videoCostLabel,
} from "../../types/costDisplay";

const FRAME = { width: 1080, height: 1920 };

/** Egyptian Arabic sample with an English term and a number mixed in. */
const ARABIC_WORDS = [
  { text: "بتخسر", startMs: 0, endMs: 480 },
  { text: "عملاء", startMs: 480, endMs: 980 },
  { text: "كل", startMs: 980, endMs: 1180 },
  { text: "يوم", startMs: 1180, endMs: 1600 },
  { text: "عشان", startMs: 1600, endMs: 1980 },
  { text: "موقعك", startMs: 1980, endMs: 2460 },
  { text: "مش", startMs: 2460, endMs: 2660 },
  { text: "responsive", startMs: 2660, endMs: 3320 },
  { text: "ولسه", startMs: 3320, endMs: 3700 },
  { text: "بيحمل", startMs: 3700, endMs: 4200 },
  { text: "في", startMs: 4200, endMs: 4360 },
  { text: "30", startMs: 4360, endMs: 4700 },
  { text: "ثانية.", startMs: 4700, endMs: 5300 },
];

describe("ElevenLabs native alignment", () => {
  const alignmentFor = (text: string) => ({
    alignment: {
      characters: [...text],
      character_start_times_seconds: [...text].map((_, i) => i * 0.1),
      character_end_times_seconds: [...text].map((_, i) => (i + 1) * 0.1),
    },
  });

  it("parses the documented with-timestamps payload", () => {
    const parsed = parseElevenLabsAlignment(alignmentFor("ابدأ"));
    expect(parsed).not.toBeNull();
    expect(parsed!.characters.join("")).toBe("ابدأ");
    expect(parsed!.startSeconds).toHaveLength(4);
  });

  it("rejects a partial alignment rather than half-using it", () => {
    expect(
      parseElevenLabsAlignment({
        alignment: {
          characters: ["a", "b"],
          character_start_times_seconds: [0],
          character_end_times_seconds: [0.1, 0.2],
        },
      }),
    ).toBeNull();
    expect(parseElevenLabsAlignment({ alignment: null })).toBeNull();
    expect(parseElevenLabsAlignment(undefined)).toBeNull();
  });

  it("only accepts an alignment that describes the submitted text", () => {
    const parsed = parseElevenLabsAlignment(alignmentFor("ابدأ"))!;
    expect(alignmentMatchesText(parsed, "ابدأ")).toBe(true);
    expect(alignmentMatchesText(parsed, "ابدأ دلوقتي")).toBe(false);
  });

  it("keeps character spans when tokenizing", () => {
    const tokens = tokenizeWithSpans("ابدأ دلوقتي");
    expect(tokens).toHaveLength(2);
    expect(tokens[1].startIndex).toBe(5);
    expect("ابدأ دلوقتي".slice(tokens[1].startIndex, tokens[1].endIndex)).toBe("دلوقتي");
  });

  it("matches Arabic tokens across punctuation and orthographic variants", () => {
    expect(normalizeForMatch("دلوقتي،")).toBe(normalizeForMatch("دلوقتي"));
    expect(normalizeForMatch("إبدأ")).toBe(normalizeForMatch("ابدأ"));
  });

  it("maps alignment onto identical display tokens at full confidence", () => {
    const text = "ابدأ دلوقتي";
    const parsed = parseElevenLabsAlignment(alignmentFor(text))!;
    const mapping = mapAlignmentToCaptionTokens(parsed, text, ["ابدأ", "دلوقتي"]);
    expect(mapping.confidence).toBe(1);
    expect(mapping.unmappedTokens).toEqual([]);
    expect(mapping.timings[0].startMs).toBe(0);
    expect(mapping.timings[1].endMs).toBeGreaterThan(mapping.timings[0].endMs);
    expect(isAlignmentConfident(mapping)).toBe(true);
  });

  it("never shows a spoken expansion in place of the written caption token", () => {
    // TTS says "سنة الفين وستة وعشرين"; the caption must still read "2026".
    const ttsText = "في سنة الفين وستة وعشرين";
    const parsed = parseElevenLabsAlignment(alignmentFor(ttsText))!;
    const mapping = mapAlignmentToCaptionTokens(parsed, ttsText, ["في", "2026"]);
    expect(mapping.timings.map((t) => t.word)).toEqual(["في", "2026"]);
    expect(mapping.unmappedTokens).toContain("2026");
    // Confidence drops, so the caller falls back to Whisper for this segment.
    expect(mapping.confidence).toBeLessThan(ALIGNMENT_CONFIDENCE_THRESHOLD);
    expect(isAlignmentConfident(mapping)).toBe(false);
  });

  it("still produces monotonic timings for an interpolated token", () => {
    const ttsText = "ثلاثين بالمية خصم";
    const parsed = parseElevenLabsAlignment(alignmentFor(ttsText))!;
    const mapping = mapAlignmentToCaptionTokens(parsed, ttsText, ["30%", "خصم"]);
    expect(mapping.timings).toHaveLength(2);
    mapping.timings.forEach((timing) => {
      expect(timing.endMs).toBeGreaterThanOrEqual(timing.startMs);
    });
    expect(mapping.timings[1].startMs).toBeGreaterThanOrEqual(mapping.timings[0].startMs);
  });

  it("treats an empty display token list as unusable", () => {
    const parsed = parseElevenLabsAlignment(alignmentFor("ابدأ"))!;
    const mapping = mapAlignmentToCaptionTokens(parsed, "ابدأ", []);
    expect(mapping.timings).toEqual([]);
    expect(isAlignmentConfident(mapping)).toBe(false);
  });
});

describe("Caption styles and font pack", () => {
  it("bundles every font a style references, under OFL", () => {
    const fontDir = path.resolve(__dirname, "../../../assets/fonts");
    expect(fs.existsSync(fontDir)).toBe(true);
    const present = fs.readdirSync(fontDir);
    Object.values(CAPTION_FONTS).forEach((font) => {
      expect(font.license).toBe("OFL-1.1");
      // At least the variable/regular source must be bundled; static weights
      // are instanced from it during the image build.
      expect(font.files.some((file) => present.includes(file))).toBe(true);
    });
  });

  it("maps the rejected viral_bold treatment onto the redesigned Social Ad style", () => {
    expect(resolveCaptionStyle("viral_bold").id).toBe("social_ad");
    expect(resolveCaptionStyle("bold").id).toBe("social_ad");
    // In V2.3-03, 'cinematic' was promoted to a first-class style preset rather than collapsing to clean_professional.
    expect(resolveCaptionStyle("cinematic").id).toBe("cinematic");
    expect(resolveCaptionStyle(undefined).id).toBe("social_ad");
    expect(resolveCaptionStyle("not_a_style").id).toBe("social_ad");
  });

  it("provides the four required styles with complete definitions", () => {
    ["clean_professional", "social_ad", "minimal", "kinetic_phrase"].forEach((id) => {
      expect(CAPTION_STYLE_IDS).toContain(id);
    });
    Object.values(CAPTION_STYLES).forEach((style) => {
      expect(style.minSizeRatio).toBeLessThan(style.maxSizeRatio);
      expect(style.maxLines).toBeGreaterThanOrEqual(1);
      expect(style.maxWidthRatio).toBeLessThanOrEqual(0.9);
      expect(style.bottomSafeRatio).toBeGreaterThan(0.1);
      expect(style.lineHeight).toBeGreaterThan(1);
    });
  });

  it("drops the meme-weight outline the product owner rejected", () => {
    // The rejected build used a very heavy stroke; every V3 style stays subtle.
    Object.values(CAPTION_STYLES).forEach((style) => {
      expect(style.outlinePx).toBeLessThanOrEqual(3);
    });
  });
});

describe("Arabic caption renderer V3", () => {
  it("measures Arabic width without counting zero-width marks", () => {
    const plain = measureTextWidth("بتحمل", 100);
    const withTashkeel = measureTextWidth("بتحمّل", 100);
    expect(withTashkeel).toBeCloseTo(plain, 5);
    expect(measureTextWidth("", 100)).toBe(0);
  });

  it("wraps on measured width rather than word count", () => {
    const lines = wrapWords(["كلمة", "كلمة", "كلمة", "كلمة"], 100, 220);
    expect(lines.length).toBeGreaterThan(1);
    lines.forEach((line) => expect(measureTextWidth(line, 100)).toBeLessThanOrEqual(220));
  });

  it("shrinks the font until the phrase fits the style's line budget", () => {
    const style = CAPTION_STYLES.social_ad;
    const many = "كلمة".split(" ").concat(new Array(14).fill("كلمة"));
    const fitted = fitFontSize(many, style, FRAME);
    expect(fitted.fontSize).toBeLessThanOrEqual(Math.round(FRAME.height * style.maxSizeRatio));
    expect(fitted.fontSize).toBeGreaterThanOrEqual(Math.round(FRAME.height * style.minSizeRatio));
  });

  it("chunks on punctuation and pauses instead of a fixed word count", () => {
    const phrases = chunkIntoPhrases(ARABIC_WORDS);
    expect(phrases.length).toBeGreaterThan(1);
    phrases.forEach((phrase) => {
      expect(phrase.words.length).toBeGreaterThan(0);
      expect(phrase.endMs).toBeGreaterThan(phrase.startMs);
    });
    // Phrases must not overlap in time.
    for (let i = 1; i < phrases.length; i++) {
      expect(phrases[i].startMs).toBeGreaterThanOrEqual(phrases[i - 1].endMs);
    }
  });

  it("splits on a long silent gap", () => {
    const gapped = [
      { text: "ابدأ", startMs: 0, endMs: 700 },
      { text: "دلوقتي", startMs: 700, endMs: 1400 },
      // 900ms of silence.
      { text: "واتساب", startMs: 2300, endMs: 3000 },
    ];
    expect(chunkIntoPhrases(gapped).length).toBeGreaterThan(1);
  });

  it("emits ASS colours in the &HAABBGGRR order libass expects", () => {
    expect(toAssColour("#FFC53D")).toBe("&H003DC5FF");
    expect(toAssColour("#000000", 1)).toBe("&HFF000000");
  });

  it("formats ASS timestamps", () => {
    expect(formatAssTime(0)).toBe("0:00:00.00");
    expect(formatAssTime(65432)).toBe("0:01:05.43");
    expect(formatAssTime(-5)).toBe("0:00:00.00");
  });

  it("escapes only ASS control characters, never the letters", () => {
    expect(escapeAssText("ابدأ {دلوقتي}")).toBe("ابدأ \\{دلوقتي\\}");
    expect(escapeAssText("ابدأ دلوقتي")).toBe("ابدأ دلوقتي");
  });

  it("builds a complete ASS script with real frame geometry", () => {
    const built = renderArabicCaptions(ARABIC_WORDS, "social_ad", FRAME, 0.14);
    expect(built.content).toContain("[Script Info]");
    expect(built.content).toContain(`PlayResX: ${FRAME.width}`);
    expect(built.content).toContain(`PlayResY: ${FRAME.height}`);
    expect(built.content).toContain("[Events]");
    expect(built.content).toContain("Dialogue:");
    expect(built.fontFamily).toBe("Cairo");
    expect(built.phrases.length).toBeGreaterThan(0);
  });

  it("passes Arabic through in logical order with no reversal or presentation forms", () => {
    const built = renderArabicCaptions(ARABIC_WORDS, "social_ad", FRAME);
    // The logical string must survive into the script for HarfBuzz to shape.
    expect(built.content).toContain("بتخسر");
    expect(built.content).not.toMatch(/[ﭐ-﷿ﹰ-﻿]/);
    expect(built.content).not.toMatch(/[‫‮]/);
  });

  it("keeps the active word inside one shaped run using karaoke timing (Karaoke preset)", () => {
    const built = renderArabicCaptions(ARABIC_WORDS, "karaoke", FRAME);
    // \k markers mean libass fills the existing run; no duplicate positioned
    // word is drawn over the phrase, which is what broke shaping in V2.2.
    expect(built.content).toMatch(/\\k\d+/);
    const dialogueLines = built.content.split("\n").filter((line) => line.startsWith("Dialogue:"));
    expect(dialogueLines.length).toBe(built.phrases.length);
    // One event per phrase - not one per word.
    expect(dialogueLines.length).toBeLessThan(ARABIC_WORDS.length);
  });

  it("Arabic Bold Social (social_ad) renders one uninterrupted logical phrase, never per-word overrides", () => {
    const built = renderArabicCaptions(ARABIC_WORDS, "social_ad", FRAME);
    expect(built.content).not.toMatch(/\\k\d+/);
    expect(built.content).not.toMatch(/\\c&H/);
    const dialogueLines = built.content.split("\n").filter((line) => line.startsWith("Dialogue:"));
    expect(dialogueLines.length).toBe(built.phrases.length);
  });

  it("emits no karaoke markers for a phrase-level style", () => {
    const built = renderArabicCaptions(ARABIC_WORDS, "kinetic_phrase", FRAME);
    expect(built.content).not.toMatch(/\\k\d+/);
  });

  it("keeps mixed Arabic, English and digits in one run", () => {
    const built = renderArabicCaptions(ARABIC_WORDS, "clean_professional", FRAME);
    expect(built.content).toContain("responsive");
    expect(built.content).toContain("30");
  });

  it("holds captions above the platform UI band when one is reserved", () => {
    const plain = buildArabicAss(ARABIC_WORDS, { style: CAPTION_STYLES.minimal, frame: FRAME });
    const guarded = buildArabicAss(ARABIC_WORDS, {
      style: CAPTION_STYLES.minimal,
      frame: FRAME,
      platformSafeBottomRatio: 0.3,
    });
    const marginOf = (content: string) =>
      Number(content.split("\n").find((l) => l.startsWith("Style: "))!.split(",")[21]);
    expect(marginOf(guarded.content)).toBeGreaterThan(marginOf(plain.content));
  });
});

describe("Caption QA", () => {
  const style = CAPTION_STYLES.social_ad;

  it("passes a well-formed Arabic build", () => {
    const built = renderArabicCaptions(ARABIC_WORDS, "social_ad", FRAME, 0.14);
    const qa = runCaptionQa(built, { style, frame: FRAME, platformSafeBottomRatio: 0.14 });
    expect(qa.pass).toBe(true);
    expect(qa.checkedPhrases).toBe(built.phrases.length);
  });

  it("detects hand-reversed Arabic presentation forms", () => {
    const issue = detectBrokenArabicShaping("ﻡﻼﺴﻟﺍ");
    expect(issue?.code).toBe("broken_arabic_shaping");
  });

  it("detects tofu and replacement glyphs", () => {
    expect(detectBrokenArabicShaping("ابدأ �")?.code).toBe("missing_glyph");
  });

  it("detects an explicit RTL override", () => {
    expect(detectBrokenArabicShaping("‮ابدأ")?.code).toBe("broken_arabic_shaping");
  });

  it("accepts correctly formed logical-order Arabic", () => {
    expect(detectBrokenArabicShaping("ابدأ دلوقتي")).toBeNull();
  });

  it("flags a line measured wider than the safe width", () => {
    const built = renderArabicCaptions(ARABIC_WORDS, "social_ad", FRAME);
    built.phrases[0].lines = ["كلمة ".repeat(40).trim()];
    const qa = runCaptionQa(built, { style, frame: FRAME });
    expect(qa.pass).toBe(false);
    expect(qa.issues.some((i) => i.code === "text_outside_frame")).toBe(true);
  });

  it("flags more lines than the style permits", () => {
    const built = renderArabicCaptions(ARABIC_WORDS, "social_ad", FRAME);
    built.phrases[0].lines = ["سطر", "سطر", "سطر"];
    const qa = runCaptionQa(built, { style, frame: FRAME });
    expect(qa.issues.some((i) => i.code === "too_many_lines")).toBe(true);
  });

  it("flags a phrase that produced no renderable text", () => {
    const built = renderArabicCaptions(ARABIC_WORDS, "social_ad", FRAME);
    built.phrases[0].text = "";
    built.phrases[0].lines = [];
    const qa = runCaptionQa(built, { style, frame: FRAME });
    expect(qa.pass).toBe(false);
    expect(qa.issues.some((i) => i.code === "missing_glyph")).toBe(true);
  });

  it("flags a collision with the reserved CTA band", () => {
    const built = renderArabicCaptions(ARABIC_WORDS, "social_ad", FRAME, 0.14);
    const qa = runCaptionQa(built, {
      style,
      frame: FRAME,
      platformSafeBottomRatio: 0.14,
      // A CTA occupying the whole lower half must collide.
      ctaBand: { topRatio: 0.5, bottomRatio: 1 },
    });
    expect(qa.issues.some((i) => i.code === "cta_collision")).toBe(true);
  });

  it("flags two phrases visible at once", () => {
    const built = renderArabicCaptions(ARABIC_WORDS, "social_ad", FRAME);
    if (built.phrases.length > 1) {
      built.phrases[1].startMs = built.phrases[0].endMs - 500;
      const qa = runCaptionQa(built, { style, frame: FRAME });
      expect(qa.issues.some((i) => i.code === "line_overlap")).toBe(true);
    }
  });
});

describe("Edit decision list", () => {
  const scenes = [
    { sceneId: "sc0", sceneIndex: 0, purpose: "hook", durationSeconds: 6.7, startSeconds: 0, searchTerms: ["a"] },
    { sceneId: "sc1", sceneIndex: 1, purpose: "solution", durationSeconds: 6.7, startSeconds: 6.7, searchTerms: ["b"] },
    { sceneId: "sc2", sceneIndex: 2, purpose: "cta", durationSeconds: 6.6, startSeconds: 13.4, searchTerms: ["c"] },
  ];

  it("cuts three narration scenes into more visual shots", () => {
    const edl = buildEditDecisionList({ scenes, totalDurationSeconds: 20 });
    // The rejected build produced exactly one shot per narration scene.
    expect(edl.shots.length).toBeGreaterThan(scenes.length);
    expect(edl.shots.length).toBeGreaterThanOrEqual(5);
    expect(edl.shots.length).toBeLessThanOrEqual(8);
  });

  it("keeps every shot inside the video and leaves no gaps", () => {
    const edl = buildEditDecisionList({ scenes, totalDurationSeconds: 20 });
    edl.shots.forEach((shot) => {
      expect(shot.start).toBeGreaterThanOrEqual(0);
      expect(shot.duration).toBeGreaterThan(0);
      expect(shot.start + shot.duration).toBeLessThanOrEqual(20.001);
    });
    for (let i = 1; i < edl.shots.length; i++) {
      expect(edl.shots[i].start).toBeCloseTo(
        edl.shots[i - 1].start + edl.shots[i - 1].duration,
        2,
      );
    }
  });

  it("maps every shot back to its narration scene", () => {
    const edl = buildEditDecisionList({ scenes, totalDurationSeconds: 20 });
    edl.shots.forEach((shot) => {
      expect(scenes.some((scene) => scene.sceneId === shot.narrationSceneId)).toBe(true);
      expect(shot.shotId).toContain(shot.narrationSceneId);
    });
  });

  it("paces the hook faster than the CTA", () => {
    const edl = buildEditDecisionList({ scenes, totalDurationSeconds: 20 });
    const hookShots = edl.shots.filter((s) => s.narrationSceneId === "sc0");
    const ctaShots = edl.shots.filter((s) => s.narrationSceneId === "sc2");
    const avg = (list: VisualShot[]) => list.reduce((sum, s) => sum + s.duration, 0) / list.length;
    expect(avg(hookShots)).toBeLessThan(avg(ctaShots));
  });

  it("does not hardcode one universal shot duration", () => {
    const edl = buildEditDecisionList({ scenes, totalDurationSeconds: 20 });
    const durations = new Set(edl.shots.map((s) => Math.round(s.duration * 10)));
    expect(durations.size).toBeGreaterThan(1);
  });

  it("slows down under a calmer pacing profile", () => {
    const fast = buildEditDecisionList({ scenes, totalDurationSeconds: 20, pacingProfile: "editorial_ad" });
    const calm = buildEditDecisionList({ scenes, totalDurationSeconds: 20, pacingProfile: "calm" });
    expect(calm.shots.length).toBeLessThanOrEqual(fast.shots.length);
  });

  it("treats beats as hints without snapping every cut", () => {
    const beats = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0];
    const edl = buildEditDecisionList({ scenes, totalDurationSeconds: 20, beats });
    expect(edl.beatMapUsed).toBe(true);
    const snapped = edl.shots.filter((s) => s.beatHint !== undefined);
    expect(snapped.length).toBeLessThan(edl.shots.length);
  });

  it("finds only a beat within tolerance", () => {
    expect(nearestBeat(2.05, [1, 2, 3])).toBe(2);
    expect(nearestBeat(2.5, [1, 2, 3], 0.1)).toBeUndefined();
    expect(nearestBeat(1, [])).toBeUndefined();
  });

  it("defaults to a hard cut and reserves effects for motivated changes", () => {
    const base: VisualShot = {
      shotId: "a", narrationSceneId: "s1", narrationSceneIndex: 0, intent: "detail",
      sourceType: "stock", start: 0, duration: 2,
    };
    expect(transitionBetween(undefined, base)).toBe("none");
    expect(transitionBetween({ ...base }, { ...base, shotId: "b" })).toBe("cut");
    expect(
      transitionBetween(
        { ...base, intent: "contrast_before" },
        { ...base, shotId: "b", intent: "contrast_after" },
      ),
    ).toBe("push");
    expect(
      transitionBetween(
        { ...base, narrationSceneId: "s1" },
        { ...base, shotId: "b", narrationSceneId: "s2", sourceType: "mockup" },
      ),
    ).toBe("crossfade");
  });

  it("counts source diversity for the hybrid check", () => {
    const edl = buildEditDecisionList({
      scenes,
      totalDurationSeconds: 20,
      assignSource: (shot, indexInScene) =>
        indexInScene % 2 === 0
          ? { sourceType: "stock", provider: "pexels", routingReason: "footage_reads_better" }
          : { sourceType: "mockup", provider: "abud_mockup", routingReason: "website_intent" },
    });
    expect(sourceTypeDiversity(edl)).toBeGreaterThanOrEqual(2);
    expect(edl.sourceTypeCounts.mockup).toBeGreaterThan(0);
    expect(edl.shots.every((shot) => shot.routingReason)).toBe(true);
  });

  it("maps scene purpose onto shot intent", () => {
    expect(intentForPurpose("hook")).toBe("hook");
    expect(intentForPurpose("cta")).toBe("cta");
    expect(intentForPurpose(undefined, 0.9)).toBe("cta");
    expect(intentForPurpose(undefined, 0.5)).toBe("detail");
  });

  it("never returns fewer than one shot for a very short scene", () => {
    expect(
      shotCountForScene(
        { sceneId: "x", sceneIndex: 0, durationSeconds: 0.5, startSeconds: 0 },
        "hook",
        "editorial_ad",
      ),
    ).toBe(1);
  });
});

describe("Stock providers", () => {
  it("reports Pixabay as unconfigured without a key, and never blocks readiness", () => {
    const provider = new PixabayProvider("");
    expect(provider.isConfigured()).toBe(false);
    const registry = new StockProviderRegistry([provider]);
    expect(registry.configuredProviders()).toHaveLength(0);
  });

  it("returns nothing rather than throwing when unconfigured", async () => {
    const provider = new PixabayProvider("");
    await expect(provider.search({ query: "office", orientation: "portrait", kind: "video" })).resolves.toEqual([]);
  });

  it("builds correct Pixabay attribution", () => {
    const provider = new PixabayProvider("pixabay_test_key_123456");
    const attribution = provider.attributionFor({
      provider: "pixabay", id: "42", kind: "video", downloadUrl: "https://example.invalid/v.mp4",
      width: 1080, height: 1920, contributor: "Someone", sourcePageUrl: "https://pixabay.com/x",
    });
    expect(attribution.credit).toBe("Someone via Pixabay");
    expect(attribution.license).toBe("Pixabay Content License");
    expect(attribution.assetId).toBe("42");
  });

  it("scores portrait clips above landscape for a 9:16 request", () => {
    const request = { query: "modern website", orientation: "portrait" as const, kind: "video" as const };
    const portrait = scoreCandidateQuality(
      { provider: "pixabay", id: "1", kind: "video", downloadUrl: "u", width: 1080, height: 1920, durationSeconds: 12 },
      request,
    );
    const landscape = scoreCandidateQuality(
      { provider: "pixabay", id: "2", kind: "video", downloadUrl: "u", width: 1920, height: 1080, durationSeconds: 12 },
      request,
    );
    expect(portrait).toBeGreaterThan(landscape);
  });

  it("scores tag overlap with the intent", () => {
    const high = scoreCandidateSemantics(
      { provider: "pixabay", id: "1", kind: "video", downloadUrl: "u", width: 1, height: 1, tags: ["website", "design"] },
      "website design",
    );
    const low = scoreCandidateSemantics(
      { provider: "pixabay", id: "2", kind: "video", downloadUrl: "u", width: 1, height: 1, tags: ["forest", "river"] },
      "website design",
    );
    expect(high).toBeGreaterThan(low);
  });

  const scored = (over: Partial<ScoredCandidate>): ScoredCandidate => ({
    provider: "pixabay", id: "1", kind: "video", downloadUrl: "u", width: 1080, height: 1920,
    qualityScore: 70, semanticScore: 70, totalScore: 70, ...over,
  });

  it("removes the same asset twice", () => {
    const result = dedupeCandidates([scored({ id: "7" }), scored({ id: "7" })]);
    expect(result).toHaveLength(1);
  });

  it("limits clips from one contributor, which are usually one shoot", () => {
    const result = dedupeCandidates([
      scored({ id: "1", contributor: "Same", tags: ["a"] }),
      scored({ id: "2", contributor: "Same", tags: ["b"] }),
      scored({ id: "3", contributor: "Other", tags: ["c"] }),
    ]);
    expect(result.filter((c) => c.contributor === "Same")).toHaveLength(1);
    expect(result).toHaveLength(2);
  });

  it("removes visually near-duplicate candidates by tag overlap", () => {
    const result = dedupeCandidates([
      scored({ id: "1", contributor: "A", tags: ["laptop", "office", "desk"], totalScore: 90 }),
      scored({ id: "2", contributor: "B", tags: ["laptop", "office", "desk"], totalScore: 80 }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");
  });

  it("keeps the higher-scoring candidate when de-duplicating", () => {
    const result = dedupeCandidates([
      scored({ id: "low", contributor: "A", tags: ["x"], totalScore: 40 }),
      scored({ id: "high", contributor: "A", tags: ["y"], totalScore: 95 }),
    ]);
    expect(result[0].id).toBe("high");
  });

  it("returns no candidates when no provider is configured", async () => {
    const registry = new StockProviderRegistry([new PixabayProvider("")]);
    await expect(
      registry.searchAll({ query: "office", orientation: "portrait", kind: "video" }),
    ).resolves.toEqual([]);
  });
});

describe("Website mockup renderer", () => {
  it("renders every template as valid standalone SVG", () => {
    MOCKUP_TEMPLATE_IDS.forEach((template) => {
      const svg = renderMockupSvg({ template, width: 1080, height: 1920 });
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(svg).toContain('width="1080"');
    });
  });

  it("is deterministic for the same request", () => {
    const request = { template: "before_after" as const, width: 1080, height: 1920, progress: 0.5 };
    expect(renderMockupSvg(request)).toBe(renderMockupSvg(request));
  });

  it("renders Arabic copy without reordering it", () => {
    const svg = renderMockupSvg({
      template: "cta_card", width: 1080, height: 1920,
      content: { headline: "ابدأ دلوقتي", ctaLabel: "اتصل بينا" },
    });
    expect(svg).toContain("ابدأ دلوقتي");
    expect(svg).not.toMatch(/[ﭐ-﷿ﹰ-﻿]/);
  });

  it("escapes XML metacharacters in supplied copy", () => {
    const svg = renderMockupSvg({
      template: "cta_card", width: 1080, height: 1920,
      content: { headline: "Design & <build>" },
    });
    expect(svg).toContain("Design &amp; &lt;build&gt;");
    expect(svg).not.toContain("<build>");
  });

  it("prefers a mockup for website intents and footage otherwise", () => {
    expect(mockupForIntent("contrast_before")).toBe("before_after");
    expect(mockupForIntent("cta")).toBe("cta_card");
    expect(mockupForIntent("solution")).toBe("responsive_transition");
    // A generic hook is better served by real footage.
    expect(mockupForIntent("hook")).toBeNull();
  });

  it("advances animated templates with progress", () => {
    const early = renderMockupSvg({ template: "speed_card", width: 1080, height: 1920, progress: 0.1 });
    const late = renderMockupSvg({ template: "speed_card", width: 1080, height: 1920, progress: 0.9 });
    expect(early).not.toBe(late);
  });
});

describe("Scene detection window selection", () => {
  const detected = (shots: Array<[number, number]>): SceneDetectionResult => ({
    available: true,
    source: "pyscenedetect",
    shots: shots.map(([startSeconds, endSeconds]) => ({
      startSeconds,
      endSeconds,
      durationSeconds: endSeconds - startSeconds,
    })),
  });

  it("skips a dead intro shot and uses an interior one", () => {
    const window = selectBestWindow(detected([[0, 1.2], [1.2, 9], [9, 12]]), 12, 3);
    expect(window.startSeconds).toBeGreaterThanOrEqual(1.2);
    expect(window.reason).toBe("interior_shot");
    expect(window.durationSeconds).toBe(3);
  });

  it("never starts at zero just because detection is unavailable", () => {
    const window = selectBestWindow(
      { available: false, shots: [], source: "fallback" },
      12,
      3,
    );
    expect(window.startSeconds).toBeGreaterThan(0);
    expect(window.reason).toBe("detection_unavailable");
  });

  it("keeps the window inside the clip", () => {
    const window = selectBestWindow({ available: false, shots: [], source: "fallback" }, 2, 5);
    expect(window.startSeconds).toBeGreaterThanOrEqual(0);
    expect(window.startSeconds + window.durationSeconds).toBeLessThanOrEqual(2.001);
  });

  it("falls back when no detected shot is long enough", () => {
    const window = selectBestWindow(detected([[0, 0.5], [0.5, 1]]), 10, 4);
    expect(window.reason).toBe("no_shot_long_enough");
  });
});

describe("Cost display regression", () => {
  it("never renders undefined, null or NaN as money", () => {
    // The exact defect reported on the rejected acceptance video.
    expect(videoCostLabel({ estimatedCost: undefined })).toBe("Not estimated");
    expect(videoCostLabel({ estimatedCost: null as any })).toBe("Not estimated");
    expect(videoCostLabel({ estimatedCost: NaN })).toBe("Not estimated");
    expect(videoCostLabel(null)).toBe("Not estimated");
    [undefined, null as any, NaN, "12" as any].forEach((value) => {
      expect(videoCostLabel({ estimatedCost: value })).not.toContain("undefined");
      expect(videoCostLabel({ estimatedCost: value })).not.toContain("NaN");
      expect(videoCostLabel({ estimatedCost: value })).not.toContain("null");
    });
  });

  it("labels an ElevenLabs production as usage based, never $0", () => {
    const cost = {
      estimatedCost: 0,
      isFree: false,
      usageBased: true,
      breakdown: { voice: { provider: "elevenlabs", usageBased: true, estimatedCostTier: "premium" } },
    };
    expect(isUsageBasedCost(cost)).toBe(true);
    expect(isFreeCost(cost)).toBe(false);
    expect(videoCostLabel(cost)).toBe("ElevenLabs · Usage Based");
    expect(externalCostLabel(cost)).toContain("Usage Based");
  });

  it("still shows a genuinely free local pipeline as free", () => {
    const cost = { estimatedCost: 0, isFree: true, breakdown: { voice: { provider: "kokoro" } } };
    expect(isFreeCost(cost)).toBe(true);
    expect(videoCostLabel(cost)).toBe("Free ($0)");
  });

  it("formats a real amount with two decimals", () => {
    expect(videoCostLabel({ estimatedCost: 1.5, currency: "USD" })).toBe("$1.50 USD");
  });

  it("validates displayable amounts", () => {
    expect(isDisplayableAmount(0)).toBe(true);
    expect(isDisplayableAmount(NaN)).toBe(false);
    expect(isDisplayableAmount(Infinity)).toBe(false);
    expect(isDisplayableAmount("1")).toBe(false);
    expect(isDisplayableAmount(undefined)).toBe(false);
  });
});

describe("Visual intent policy", () => {
  it("removes code footage from a website ad and substitutes product visuals", () => {
    const result = applyVisualIntentPolicy({
      terms: ["web developer coding", "modern office", "programming screen"],
      narration: "فريقنا بيصمملك موقع سريع ومتوافق مع الموبايل",
      isWebsiteAd: true,
      sceneIndex: 1,
    });
    expect(result.applied).toBe(true);
    expect(result.removed).toContain("web developer coding");
    expect(result.terms.some((t) => looksLikeCodeFootageTerm(t))).toBe(false);
    expect(result.terms).toContain("modern office");
    expect(result.substituted.length).toBeGreaterThan(0);
  });

  it("keeps code footage when the narration really is about development", () => {
    const result = applyVisualIntentPolicy({
      terms: ["web developer coding"],
      narration: "بنعمل backend و API للمشاريع الكبيرة",
      isWebsiteAd: true,
    });
    expect(result.applied).toBe(false);
    expect(result.terms).toEqual(["web developer coding"]);
  });

  it("leaves non-website productions untouched", () => {
    const result = applyVisualIntentPolicy({
      terms: ["programming screen"],
      narration: "إعلان مطعم",
      isWebsiteAd: false,
    });
    expect(result.applied).toBe(false);
    expect(result.terms).toEqual(["programming screen"]);
  });

  it("recognises engineering narration", () => {
    expect(narrationIsEngineering("نكتب كود نظيف")).toBe(true);
    expect(narrationIsEngineering("موقع سريع وحديث")).toBe(false);
    expect(narrationIsEngineering(undefined)).toBe(false);
  });

  it("identifies code-shop search terms", () => {
    expect(looksLikeCodeFootageTerm("web developer coding")).toBe(true);
    expect(looksLikeCodeFootageTerm("HTML editor")).toBe(true);
    expect(looksLikeCodeFootageTerm("happy client handshake")).toBe(false);
  });
});
