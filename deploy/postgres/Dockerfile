FROM postgres:18-bookworm AS extension-builder

ARG PGXNCLIENT_VERSION=1.3.2

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        libpq-dev \
        postgresql-server-dev-18 \
        python3 \
        python3-pip \
        python3-venv \
    && rm -rf /var/lib/apt/lists/*

COPY extensions.pgxn /tmp/extensions.pgxn

RUN python3 -m venv /opt/pgxn \
    && /opt/pgxn/bin/pip install --no-cache-dir "pgxnclient==${PGXNCLIENT_VERSION}" \
    && while IFS= read -r spec; do \
        case "$spec" in ''|'#'*) continue ;; esac; \
        /opt/pgxn/bin/pgxn --yes install \
          --pg_config /usr/lib/postgresql/18/bin/pg_config "$spec"; \
      done < /tmp/extensions.pgxn

FROM postgres:18-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-18-postgis-3 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=extension-builder /usr/lib/postgresql/18/ /usr/lib/postgresql/18/
COPY --from=extension-builder /usr/share/postgresql/18/ /usr/share/postgresql/18/
