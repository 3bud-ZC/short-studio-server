FROM ubuntu:22.04 AS install-whisper
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
  && apt-get install -y --no-install-recommends git build-essential wget cmake ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /whisper
RUN git clone https://github.com/ggml-org/whisper.cpp.git . \
  && git checkout v1.7.1 \
  && make
WORKDIR /whisper/models
RUN sh ./download-ggml-model.sh small

FROM node:22-bookworm-slim AS base
ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    git wget cmake ffmpeg curl make ca-certificates fontconfig \
    python3 python3-venv python3-pip \
    libsdl2-dev libnss3 libdbus-1-3 libatk1.0-0 libgbm-dev libasound2 \
    libxrandr2 libxkbcommon-dev libxfixes3 libxcomposite1 libxdamage1 \
    libatk-bridge2.0-0 libpango-1.0-0 libcairo2 libcups2 \
  && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN npm install -g pnpm@11.7.0

FROM base AS deps
ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* /app/
# patches/ must be present before `pnpm install` runs: pnpm-workspace.yaml's
# `patchedDependencies` (the tracked @revideo/renderer --single-process fix)
# points at a file under here - without this COPY (and without
# pnpm-workspace.yaml itself, both missing until now), `pnpm install
# --frozen-lockfile` fails outright with ERR_PNPM_LOCKFILE_CONFIG_MISMATCH
# instead of silently losing the patch, because the lockfile records a patch
# hash pnpm has no local declaration for. The previous `|| true` masked that
# fatal error and let the build limp forward with no node_modules at all,
# surfacing only as a confusing "not found" on the later COPY step.
COPY patches* /app/patches/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store bash -lc "set -euxo pipefail; pnpm config set fetch-timeout 600000; pnpm install --frozen-lockfile; pnpm approve-builds --all"

FROM deps AS build
# tsconfig.revideo-project.json is required by `npm run typecheck` (part of
# `pnpm build`) even here, where the Revideo runtime itself is never shipped
# (this image has no Chromium/Puppeteer) - the typecheck step still needs the
# config file present to type the checked-in src/video-core/revideo-project
# source, matching main.Dockerfile's own build stage.
COPY tsconfig.json tsconfig.build.json tsconfig.ui.json tsconfig.revideo-project.json vite.config.ts remotion.config.ts /app/
COPY static /app/static
COPY assets /app/assets
COPY scripts /app/scripts
COPY src /app/src
RUN pnpm build

FROM base AS runtime-deps
ENV PYTHON_BIN=/opt/pyruntime/bin/python
RUN --mount=type=cache,id=abud-pip,target=/root/.cache/pip \
  python3 -m venv /opt/pyruntime \
  && /opt/pyruntime/bin/pip install --default-timeout=120 --retries=10 \
       pillow==12.3.0 \
       "numpy<2" \
       opencv-python-headless==4.10.0.84 \
       scenedetect==0.6.4 \
       librosa==0.10.2.post1 \
       fonttools==4.53.1

FROM runtime-deps
ENV DATA_DIR_PATH=/app/data
ENV DOCKER=true
ENV WHISPER_MODEL=small
ENV KOKORO_MODEL_PRECISION=q4
ENV PYTHON_BIN=/opt/pyruntime/bin/python
ENV ABUD_FONT_DIR=/usr/share/fonts/truetype/abud
ENV QUALITY_RUNTIME_ENABLED=true
ENV SCENE_DETECTION_ENABLED=true
ENV BEAT_ANALYSIS_ENABLED=true
ENV CONCURRENCY=1
ENV VIDEO_CACHE_SIZE_IN_BYTES=2097152000

COPY package.json /app/
COPY static /app/static
COPY assets /app/assets
COPY scripts /app/scripts
COPY --from=install-whisper /whisper /app/data/libs/whisper
COPY --from=install-whisper /whisper /app/bootstrap/whisper
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=build /app/dist /app/dist

RUN mkdir -p /usr/share/fonts/truetype/abud \
  && cp -R /app/assets/fonts/. /usr/share/fonts/truetype/abud/ \
  && /opt/pyruntime/bin/python /app/scripts/instance_fonts.py /usr/share/fonts/truetype/abud \
  && fc-cache -f /usr/share/fonts/truetype/abud \
  && node dist/scripts/install.js

CMD ["pnpm", "start"]
