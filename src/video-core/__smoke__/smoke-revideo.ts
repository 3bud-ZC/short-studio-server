/* Standalone smoke test - NOT part of the permanent suite, temporary for the
   Revideo evaluation spike. Run with:
     npx ts-node --transpile-only src/video-core/__smoke__/smoke-revideo.ts
   from the `source` directory. Validates the Revideo toolchain (Puppeteer +
   Vite + @revideo/2d JSX + ffmpeg mux) actually produces an mp4 on this
   machine, using synthetic fixtures (no real Pexels/TTS calls). */
import path from "path";
import { RevideoRenderer } from "../renderers/revideoRenderer";
import { buildProductionTimeline } from "../buildTimeline";

const FIXTURES =
  "C:/Users/Abud/AppData/Local/Temp/claude/C--Users-Abud-Desktop-GitHub-Abud-Shorts-Engine/6c65d913-ceea-451b-80b9-c3d0dc909c9f/scratchpad/revideo-smoke";

// Real Egyptian Arabic caption fixture - the actual proof-video topic
// (ABUD_SHORTS_ENGINE_STATUS.md "Revideo Evaluation", section 9: typography
// must be verified BEFORE the real Arabic candidate, not assumed from the
// English proof). Includes punctuation and a longer clause to exercise
// line-wrapping at 1080x1920.
const ARABIC_CAPTIONS = [
  { text: "أهمية النسخ الاحتياطي", startMs: 0, endMs: 900 },
  { text: "لملفات المشاريع الصغيرة،", startMs: 900, endMs: 1900 },
  { text: "خصوصًا في مصر!", startMs: 1900, endMs: 2700 },
];

async function main() {
  const useSourceAudio = process.env.USE_SOURCE_AUDIO === "true";
  const arabicTest = process.env.ARABIC_TEST === "true";
  const timeline = buildProductionTimeline({
    id: process.env.SMOKE_ID || "smoke1",
    width: 1080,
    height: 1920,
    fps: 25,
    template: (process.env.TEMPLATE as any) || undefined,
    interSceneGapMs: 200,
    outroHoldMs: 400,
    musicFile: path.join(FIXTURES, "music.mp3"),
    musicVolume: 0.15,
    scenes: [
      {
        id: "s0",
        sceneIndex: 0,
        purpose: "hook",
        // clip_with_audio.mp4 has a REAL embedded 330Hz tone - proves the
        // stock-audio mute policy (section 6), not just that a video-only
        // clip has nothing to leak.
        visualAsset: {
          src: path.join(FIXTURES, "clip_with_audio.mp4"),
          kind: "video",
          useSourceAudio,
        },
        narrationFile: path.join(FIXTURES, "narration0.wav"),
        narrationDurationMs: 3000,
        captionWords: arabicTest
          ? ARABIC_CAPTIONS
          : [
              { text: "hello", startMs: 0, endMs: 500 },
              { text: "there", startMs: 500, endMs: 1000 },
              { text: "friend", startMs: 1000, endMs: 1500 },
            ],
      },
      {
        id: "s1",
        sceneIndex: 1,
        purpose: "cta",
        visualAsset: { src: path.join(FIXTURES, "clip1.mp4"), kind: "video" },
        narrationFile: path.join(FIXTURES, "narration1.wav"),
        narrationDurationMs: 2000,
        transitionIn: "fade",
        captionWords: [
          { text: "goodbye", startMs: 0, endMs: 500 },
          { text: "world", startMs: 500, endMs: 1000 },
        ],
      },
    ],
  });

  const renderer = new RevideoRenderer(
    FIXTURES,
    undefined,
    undefined,
    process.env.PUPPETEER_EXECUTABLE_PATH,
  );
  const result = await renderer.render(timeline);
  console.log("SMOKE RESULT", JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("SMOKE FAILED", err);
  process.exit(1);
});
