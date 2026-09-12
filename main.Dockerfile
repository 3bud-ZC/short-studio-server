FROM debian:bookworm-slim AS install-whisper
ENV DEBIAN_FRONTEND=noninteractive
RUN apt update
# whisper install dependencies
#
# Built on debian:bookworm-slim (the same base OS/glibc as the `node:22-
# bookworm-slim` runtime stage below), not ubuntu:22.04 as before: a binary
# compiled under Ubuntu 22.04's glibc/toolchain and then copied into a
# Debian bookworm runtime crashed with SIGILL (illegal instruction) even
# after pinning a portable -march baseline - a cross-distro glibc ABI
# mismatch, confirmed by building and running the same source directly on
# each base image. Compiling in the runtime's own OS avoids that class of
# bug entirely, which is the only real way to guarantee the shipped binary
# runs unmodified in the image that ships it.
RUN apt install -y \
    git \
    build-essential \
    wget \
    cmake \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /whisper
RUN git clone https://github.com/ggml-org/whisper.cpp.git .
RUN git checkout v1.7.1
# whisper.cpp's own Makefile unconditionally appends `-march=native
# -mtune=native` for x86_64 (MK_CFLAGS/HOST_CXXFLAGS), which bakes in
# whatever CPU extensions the *build* machine happens to expose. That is
# fine for a binary built and run on the same box, but this image ships to
# customer machines with different CPUs - a build-time CPU with, say,
# AVX-512 produces a binary that crashes with SIGILL ("illegal
# instruction") on a runtime CPU without it. Pin a portable baseline
# (x86-64-v2: SSE4.2/POPCNT, universally available on real hardware since
# ~2009) instead, so the compiled binary runs everywhere this image is
# deployed rather than only on whatever machine built it.
RUN sed -i 's/-march=native -mtune=native/-march=x86-64-v2 -mtune=generic/g' Makefile
RUN make
WORKDIR /whisper/models
# "small" - not "base.en" as before - to match WHISPER_MODEL's actual
# default (docker-compose.prod.yml: WHISPER_MODEL:-small, src/config.ts:
# defaultWhisperModel = "small"). A mismatched bundled model was silently
# harmless only because the runtime entrypoint's bootstrap-copy path (see
# the final stage below) was itself broken and never used this directory.
RUN sh ./download-ggml-model.sh small

# OpenCLIP semantic media matching - build the Python runtime and download
# the ViT-B-32 checkpoint at BUILD time so a fresh container has everything
# it needs without internet access. The compose file mounts the shared data
# directory at /models, and the entrypoint seeds the checkpoint there on
# first run (same pattern as whisper.cpp above).
FROM node:22-bookworm-slim AS install-openclip
ENV DEBIAN_FRONTEND=noninteractive
RUN apt update && apt install -y python3 python3-pip python3-venv wget && apt-get clean && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/pyruntime
# Install torch from the CPU-only index (smaller, no CUDA), then open-clip-torch
# from PyPI (it depends on torch but is not hosted on the PyTorch index).
# Use --extra-index-url (not --index-url) so PyPI remains available for
# torch's own dependencies (typing-extensions, filelock, etc.).
RUN /opt/pyruntime/bin/pip install --no-cache-dir torch --extra-index-url https://download.pytorch.org/whl/cpu
RUN /opt/pyruntime/bin/pip install --no-cache-dir open-clip-torch==2.29.0
# The ViT-B-32 OpenCLIP checkpoint is COPYed from the build context (pre-
# downloaded and verified) rather than wget'd at build time - HuggingFace's
# CDN intermittently returns 5xx for large model files, which would make the
# image build non-deterministic. The checkpoint is excluded from git via
# .gitignore; it lives in assets/ alongside the Arabic caption fonts.
RUN mkdir -p /bootstrap-openclip
COPY assets/ViT-B-32-openclip-state.pt /bootstrap-openclip/ViT-B-32-openclip-state.pt

FROM node:22-bookworm-slim AS base
ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app
RUN apt update
RUN apt install -y \
    # whisper dependencies
    git \
    wget \
    cmake \
    ffmpeg \
    curl \
    make \
    libsdl2-dev \
    # OpenMP runtime the whisper.cpp binary (built with -fopenmp in the
    # install-whisper stage) links against; not pulled in transitively
    # here since this stage never installs a C/C++ compiler itself.
    libgomp1 \
    # Python 3 for OpenCLIP semantic media matching - the render worker
    # shells out to /opt/pyruntime/bin/python to run open_clip inference.
    python3 \
    python3-pip \
    python3-venv \
    # remotion dependencies
    libnss3 \
    libdbus-1-3 \
    libatk1.0-0 \
    libgbm-dev \
    libasound2 \
    libxrandr2 \
    libxkbcommon-dev \
    libxfixes3 \
    libxcomposite1 \
    libxdamage1 \
    libatk-bridge2.0-0 \
    libpango-1.0-0 \
    libcairo2 \
    libcups2 \
    # Revideo evaluation: @puppeteer/browsers (used to fetch Chromium for
    # @revideo/renderer) extracts the downloaded archive with `unzip` -
    # without it the download itself "succeeds" but leaves an empty,
    # non-functional install directory with no build-time error, only
    # discovered the first time a real render tries to launch Chromium.
    # See ABUD_SHORTS_ENGINE_STATUS.md "Revideo Evaluation" section 3/4.
    unzip \
    # Kokoro TTS phonemizer (phonemizer@1.2.1, used by kokoro-js) bundles an
    # Emscripten build of espeak-ng and expects /usr/share/espeak-ng-data
    # to exist at runtime. Without it the phonemizer throws an
    # uncaughtException that crashes the whole Node process. Install the
    # native espeak-ng-data package so the data directory is present.
    espeak-ng-data \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s /usr/lib/x86_64-linux-gnu/espeak-ng-data /usr/share/espeak-ng-data
# setup pnpm
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* /app/
# patches/ must be present before `pnpm install` runs: pnpm-workspace.yaml's
# `patchedDependencies` (the tracked @revideo/renderer --single-process fix)
# points at a file under here - without this COPY, the Docker build would
# install the UNPATCHED package with no error, silently losing the fix.
COPY patches* /app/patches/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile
RUN pnpm install --prefer-offline --no-cache --prod

FROM prod-deps AS build
COPY tsconfig.json /app
COPY tsconfig.build.json /app
COPY tsconfig.ui.json /app
COPY tsconfig.revideo-project.json /app
COPY vite.config.ts /app
COPY src /app/src
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm build

FROM base
COPY static /app/static
# Arabic caption fonts (Cairo, IBM Plex Sans Arabic, Noto Kufi/Sans Arabic)
# and other static assets. Without this COPY, the motion engine's font
# discovery falls through to system fonts and Arabic renders as tofu boxes.
COPY assets /app/assets
# Populated in two places, for two different consumers:
#
# 1. /app/data/libs/whisper - `RUN node dist/scripts/install.js` below runs
#    Whisper.init(), which checks this exact path and skips reinstalling
#    (downloading a whisper.cpp build over the network) when it is already
#    present. Without this copy, the image build itself tries to install
#    whisper.cpp fresh here and fails.
# 2. /app/bootstrap/whisper - /app/data is a host bind mount at runtime
#    (docker-compose.prod.yml: ${SHORT_STUDIO_DATA_DIR}:/app/data), which
#    fully shadows whatever the image put under /app/data/libs/whisper from
#    the very first container start, on every install. The compose
#    entrypoint already anticipates this and seeds the volume from
#    /app/bootstrap/whisper on first run (`if [ ! -f
#    /app/data/libs/whisper/models/ggml-small.bin ]; then ... cp -R
#    /app/bootstrap/whisper /app/data/libs/whisper; fi`) - that path must
#    actually exist in the image for a genuinely fresh install to come up,
#    instead of the entrypoint's `cp` failing.
COPY --from=install-whisper /whisper /app/data/libs/whisper
COPY --from=install-whisper /whisper /app/bootstrap/whisper
# OpenCLIP Python runtime and ViT-B-32 checkpoint - provisioned at build
# time so a fresh container has semantic media matching without internet.
# The checkpoint is also copied to a bootstrap directory for the entrypoint
# to seed into the /models volume on first run (same pattern as whisper).
COPY --from=install-openclip /opt/pyruntime /opt/pyruntime
COPY --from=install-openclip /bootstrap-openclip /app/bootstrap/openclip
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=build /app/dist /app/dist
# Revideo evaluation: @revideo/renderer's own Vite pipeline transforms the
# project's .ts/.tsx SOURCE at render time (its jsxImportSource is
# "@revideo/2d", not React) - it is not something tsc can precompile into
# dist/ the normal way, which is exactly why tsconfig.build.json excludes
# this folder (see its own comment). The raw source must still ship in the
# image, at the same relative path RevideoRenderer resolves from its own
# compiled location (dist/video-core/renderers/ -> ../revideo-project).
COPY src/video-core/revideo-project /app/dist/video-core/revideo-project
COPY package.json /app/

# app configuration via environment variables
ENV DATA_DIR_PATH=/app/data
ENV DOCKER=true
# Must match the model actually downloaded above (ggml-small.bin) and
# docker-compose.prod.yml's WHISPER_MODEL default - "base.en" here (while
# every other default said "small") meant Whisper.init()'s own model-file
# check never found what this stage built, forcing a full re-install
# attempt on every build.
ENV WHISPER_MODEL=small
# number of chrome tabs to use for rendering
ENV CONCURRENCY=1
# video cache - 2000MB
ENV VIDEO_CACHE_SIZE_IN_BYTES=2097152000
# Revideo evaluation: pins where Puppeteer's own executable-path resolution
# (used both by the install step below and by @revideo/renderer's
# puppeteer.launch() at render time - see src/video-core/renderers/revideoRenderer.ts)
# looks for Chromium. Deliberately NOT under /app/data: that path is a host
# bind mount at runtime (docker-compose.prod.yml) that fully shadows
# whatever the image put there, the same reason Whisper needs its
# bootstrap-copy dance above - Chromium has no such fallback, so it must
# live somewhere the bind mount never touches.
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

# Kokoro model precision must match the runtime default in
# docker-compose.prod.yml (KOKORO_MODEL_PRECISION:-q4). The build step below
# calls Kokoro.init() which downloads the ONNX model for the configured
# precision. Without this ENV, the build defaults to fp32 and only downloads
# model.onnx, while the runtime requests model_q4.onnx - causing a fetch
# failure on first voice generation in a fresh container with no internet.
ENV KOKORO_MODEL_PRECISION=q4

# install kokoro, headless chrome and ensure music files are present
RUN node dist/scripts/install.js
# Revideo evaluation: bundle Chromium for @revideo/renderer at BUILD time,
# not on a customer's first render - no internet access should be required
# to render after install. Uses puppeteer's own CLI so the exact pinned
# build for the installed puppeteer version is fetched (matches what
# puppeteer.launch() will look for at runtime), same PUPPETEER_CACHE_DIR as
# above. Fails the build (not silently degrades) if the download is
# incomplete - `puppeteer browsers install` exits non-zero on failure.
RUN node_modules/.bin/puppeteer browsers install chrome

CMD ["pnpm", "start"]
