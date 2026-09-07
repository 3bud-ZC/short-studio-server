# ABUD Shorts Engine Third-Party Notices

This file records third-party notices for ABUD Shorts Engine V2.2.0 stable.
The immutable V2.1.0 release tag, GitHub release, and client package were not
rewritten during V2.2 finalization.

## Application Runtime Dependencies

| Component | Version | Source | License / Notice |
| :--- | :--- | :--- | :--- |
| ABUD Shorts Engine package | 2.2.0 | Local repository package metadata | MIT declared by package metadata |
| Express | ^4.18.2 | npm `express` | MIT |
| React | ^19.1.0 | npm `react`, `react-dom` | MIT |
| Material UI | ^5.15.x | npm `@mui/*` | MIT |
| Remotion | ^4.0.286 | npm `remotion`, `@remotion/*` | See Remotion package license notices |
| FFmpeg installer package | ^1.1.0 | npm `@ffmpeg-installer/ffmpeg` | Package and bundled FFmpeg binary notices apply |
| fluent-ffmpeg | ^2.1.3 | npm `fluent-ffmpeg` | MIT |
| kokoro-js | ^1.2.0 | npm `kokoro-js` | See package/model notices; used for English local TTS in this product |
| google-auth-library | ^11.0.2 | npm `google-auth-library` | Apache-2.0; used only for optional server-side Google Cloud Text-to-Speech authentication |
| @fontsource/cairo | 5.3.0 | npm `@fontsource/cairo` / Fontsource Cairo package | OFL-1.1; bundled locally for offline Arabic rendering |
| IBM Plex Sans Arabic | Google Fonts release | `assets/fonts/IBMPlexSansArabic-*.ttf` (google/fonts `ofl/ibmplexsansarabic`) | OFL-1.1; bundled locally, no network fetch at render time |
| Noto Kufi Arabic | Google Fonts release | `assets/fonts/NotoKufiArabic-Variable.ttf` (google/fonts `ofl/notokufiarabic`) | OFL-1.1; static Bold/ExtraBold instanced at build time from the variable source |
| Noto Sans Arabic | Google Fonts release | `assets/fonts/NotoSansArabic-Variable.ttf` (google/fonts `ofl/notosansarabic`) | OFL-1.1; static Medium/SemiBold instanced at build time from the variable source |
| Cairo (TTF) | Google Fonts release | `assets/fonts/Cairo-Variable.ttf` (google/fonts `ofl/cairo`) | OFL-1.1; legacy caption face, static Bold instanced at build time |
| Inter (TTF) | Inter Project release (rsms/inter) | `assets/fonts/Inter-Variable.ttf` | OFL-1.1; bundled Latin caption face for the Revideo caption engine, no network fetch at render time |
| libass | system (Debian) | Arabic subtitle rendering via FFmpeg `ass` filter | ISC; linked with HarfBuzz, FriBidi, FreeType and Fontconfig |
| PySceneDetect | 0.6.4 | Optional CPU quality runtime; shot-boundary detection | BSD-3-Clause |
| librosa | 0.10.2.post1 | Optional CPU quality runtime; beat and energy analysis | ISC |
| opencv-python-headless | 4.10.0.84 | Optional CPU quality runtime; frame metrics | Apache-2.0 |
| fontTools | 4.53.1 | Build-time instancing of variable fonts into static weights | MIT |
| Pixabay API | n/a | Optional second free stock source | Pixabay Content License; results cached 24h, assets downloaded to local storage |
| piper-tts runtime | 1.7.0 | PyPI `piper-tts` | GPL-3.0-or-later runtime license |
| Piper Arabic voice model | ar_JO-kareem-medium | `rhasspy/piper-voices` model tree | MIT model metadata recorded in V2.1 status |
| whisper.cpp model | ggml-small.bin | whisper.cpp/Remotion installer path | Model/runtime notices apply; multilingual caption timing model |

## V2.2 Optional Capability Notices

The following integrations are implemented as optional control-plane or
capability-gated paths. They are not bundled as mandatory base-image runtimes
unless the operator enables the corresponding pack/runtime:

| Component | Version / Route | Source | License / Notice |
| :--- | :--- | :--- | :--- |
| edge-tts | ^7.2.8 | PyPI `edge-tts` | LGPL-3.0 per upstream LICENSE; Microsoft Edge online speech service terms apply |
| Ollama / Qwen | optional local HTTP Content AI provider | Ollama-compatible endpoint; Qwen model selected by operator | Model license depends on the locally installed model; no model is downloaded by default |
| Motion Canvas / Cairo Engine | 2.16.0 | Programmatic frame generation | MIT; Remotion-integrated Motion Canvas with Cairo typography |
| PySceneDetect | 0.7.1 | PyPI `scenedetect` | BSD-3-Clause project license |
| MediaPipe | optional Quality CPU Pack | Google MediaPipe | Apache-2.0; deterministic smart crop heuristic active as fallback |
| rembg | 2.0.81 | PyPI `rembg` | MIT; uses ONNX runtime with u2netp lightweight model |
| onnxruntime | 1.29.0 | PyPI `onnxruntime` | MIT; execution provider for rembg |
| Real-ESRGAN / Lanczos | 0.3.0 | High-quality image enhancement | BSD-3-Clause / PIL Lanczos filter |
| librosa | 0.11.0 | PyPI `librosa` | ISC; audio beat tracking and energy envelope analysis |
| soundfile | 0.14.0 | PyPI `soundfile` | BSD-3-Clause; libsndfile Python wrapper |
| Pillow (PIL) | 12.3.0 | PyPI `pillow` | HPND / PIL Software License |
| faster-whisper | optional caption backend | `SYSTRAN/faster-whisper` | MIT for runtime; model license depends on selected model |
| WhisperX | optional alignment evaluation backend | `m-bain/whisperX` | BSD-2-Clause; Arabic forced alignment remains disabled until an Arabic alignment model is verified |
| ComfyUI | optional AI GPU Pack sidecar | `Comfy-Org/ComfyUI` | GPL-3.0; isolated sidecar, not customer UI |
| Wan2.2 | optional AI GPU Pack workflow | Wan2.2 model/workflow source selected by operator | Hardware and model license acceptance required before enabling |

## Local Arabic Voice Notice

The local Arabic path separates runtime and model-weight terms:

- Runtime: `piper-tts` version `1.7.0`, GPL-3.0-or-later.
- Model: `ar_JO-kareem-medium`, source
  `https://huggingface.co/rhasspy/piper-voices/tree/main/ar/ar_JO/kareem/medium`,
  model metadata license recorded as MIT.
- Attribution: Piper voice `ar_JO/kareem` from `rhasspy/piper-voices`.
- Checksums and redistribution/commercial status are recorded in
  `ABUD_SHORTS_ENGINE_STATUS.md` under V2.1 Arabic Local Voice.

## Distribution Strategy

Installer/runtime provisioning must not claim all dependencies are MIT. Local
Arabic TTS includes a GPL-licensed runtime and separately licensed model files.
Model downloads are checksum-pinned by the application installer/runtime path
and are not silently rehosted from random mirrors.

## Optional Google Cloud TTS Notice

Google Cloud Text-to-Speech is an optional cloud provider. Credentials remain
server-side through Application Default Credentials, `GOOGLE_APPLICATION_CREDENTIALS`,
or equivalent deployment secret configuration. Google Cloud TTS is labeled
`Cloud / Free Tier Available`; billing may be required and usage above Google's
free monthly allowance may incur charges.

### Font instancing note

Static weights shipped in the runtime image are generated from the bundled OFL
variable fonts with fontTools at build time (`scripts/instance_fonts.py`).
Instances of an OFL font remain covered by OFL-1.1 and retain the upstream
Reserved Font Name. No font is fetched over the network during rendering.
