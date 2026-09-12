/* Standalone Kokoro English voice preview proof for 2.6 commercial recovery.
 * Generates real WAV audio through the actual Kokoro library used by the
 * product (kokoro-js / onnx-community/Kokoro-82M-v1.0-ONNX). */
import { Kokoro } from "../src/short-creator/libraries/Kokoro";
import { VoiceEnum } from "../src/types/shorts";
import { writeFileSync } from "fs";
import path from "path";

async function main() {
  const outDir = path.resolve("data-dev/qa-samples/kokoro-2.6-proof");
  const { mkdirSync } = await import("fs");
  mkdirSync(outDir, { recursive: true });

  const kokoro = await Kokoro.init("fp32");
  const voices = [VoiceEnum.af_heart, VoiceEnum.am_michael];
  const text = "Discover the perfect cup of coffee. Visit our cafe today and experience it for yourself!";
  for (const voice of voices) {
    const res = await kokoro.generate(text, voice);
    const buf = Buffer.from(res.audio);
    const file = path.join(outDir, `${voice}.wav`);
    writeFileSync(file, buf);
    console.log(`OK ${voice}.wav ${buf.length} bytes ${res.audioLength.toFixed(2)}s`);
  }
  console.log("KOKORO_PROOF_DONE");
}

main().catch((e) => {
  console.error("KOKORO_PROOF_FAILED:", e?.message || e);
  process.exit(1);
});
