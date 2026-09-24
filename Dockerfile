# syntax=docker/dockerfile:1
# Jira Time Reports as a service. Configuration: environment variables, see docs/DEPLOY.md.
#
# Behind a TLS-intercepting corporate proxy, pass its CA to the build (used only while
# downloading packages, not stored in the image):
#   docker build --secret id=ca_bundle,src=corp-ca.pem --build-arg HTTPS_PROXY=http://proxy:3128 .

FROM node:22-alpine AS ui
WORKDIR /ui
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=secret,id=ca_bundle,required=false \
    if [ -f /run/secrets/ca_bundle ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca_bundle; fi; \
    npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    JTT_FRONTEND_DIST=/app/frontend/dist \
    PORT=8080
WORKDIR /app
COPY backend/pyproject.toml /app/backend/pyproject.toml
COPY backend/jtt /app/backend/jtt
RUN --mount=type=secret,id=ca_bundle,required=false \
    if [ -f /run/secrets/ca_bundle ]; then export PIP_CERT=/run/secrets/ca_bundle; fi; \
    pip install --no-cache-dir /app/backend && rm -rf /app/backend
COPY --from=ui /ui/dist /app/frontend/dist
RUN useradd --system --uid 10001 --home-dir /nonexistent jtt
USER 10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"PORT\"]}/healthz', timeout=2)"
CMD ["python", "-m", "jtt"]
