# syntax=docker/dockerfile:1
# Jira Time Reports as a service. Configuration: environment variables, see docs/DEPLOY.md.
#
# The build downloads npm and PyPI packages. In a corporate network (see docs/DEPLOY.md):
#   --network host                                    use the host's DNS/VPN during the build
#   --build-arg HTTPS_PROXY=http://proxy:3128         go through an HTTP proxy
#   --secret id=ca_bundle,src=corp-ca.pem             trust a TLS-intercepting proxy's CA (not stored in the image)
#   --build-arg PIP_INDEX_URL=https://nexus/.../simple --build-arg NPM_CONFIG_REGISTRY=https://nexus/.../npm/
#                                                     use internal package mirrors instead of pypi.org / npmjs.org
#
# docker/tls-compat.cnf keeps TLS handshakes small (no post-quantum key share): large ones
# stall behind some corporate firewalls. It applies to the build and to the running service;
# run with -e OPENSSL_CONF=/etc/ssl/openssl.cnf to restore OpenSSL defaults.

FROM node:22-alpine AS ui
ARG NPM_CONFIG_REGISTRY
COPY docker/tls-compat.cnf /etc/ssl/tls-compat.cnf
ENV OPENSSL_CONF=/etc/ssl/tls-compat.cnf
WORKDIR /ui
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=secret,id=ca_bundle,required=false \
    if [ -f /run/secrets/ca_bundle ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca_bundle; fi; \
    npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
ARG PIP_INDEX_URL
ARG PIP_TRUSTED_HOST
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    JTT_FRONTEND_DIST=/app/frontend/dist \
    OPENSSL_CONF=/etc/ssl/tls-compat.cnf \
    PORT=8080
COPY docker/tls-compat.cnf /etc/ssl/tls-compat.cnf
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
