# The enclosure generator as one Linux image. Build from the repo root:
#   docker build --platform linux/amd64 -f enclosure/Dockerfile -t makeable-enclosure .
# x86_64 on purpose: some geometry libraries have no arm64 wheels.
FROM node:22-bookworm-slim AS node

FROM python:3.11-slim-bookworm

# Node runs the electrical compiler for the wires. libgomp and libglu come from the CAD kernel's needs.
COPY --from=node /usr/local/bin/node /usr/local/bin/node
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 libglu1-mesa libxrender1 libxext6 libsm6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/enclosure
COPY enclosure/requirements.txt .
# VTK from PyPI wants a display, so it is swapped for the build that renders offscreen.
RUN pip install --no-cache-dir -r requirements.txt \
    && pip uninstall -y vtk \
    && pip install --no-cache-dir --extra-index-url https://wheels.vtk.org "vtk-osmesa>=9.3,<9.6"

# The CAD kernel links to libGL even when nothing is drawn on screen.
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 && rm -rf /var/lib/apt/lists/*

# The wire compiler and its data, then the generator itself.
COPY lib /app/lib
COPY artifacts/aws-assembly-release /app/artifacts/aws-assembly-release
COPY enclosure /app/enclosure

ENV PYTHONUNBUFFERED=1 MPLBACKEND=Agg
CMD ["python", "-W", "ignore", "generate.py"]
