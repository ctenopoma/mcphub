FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV CODE_SERVER_EXTENSIONS_DIR=/root/.local/share/code-server/extensions
ENV OFFLINE_VSIX_DIR=/opt/offline-vsix

# Install dependencies including python3 and curl
RUN apt-get update && apt-get install -y \
    curl \
    python3 \
    python3-pip \
    python3-venv \
    sudo \
    && rm -rf /var/lib/apt/lists/*

# Install code-server
RUN curl -fsSL https://code-server.dev/install.sh | sh

RUN cat <<'EOF' > /usr/local/bin/start-app.sh
#!/bin/sh
set -eu

mkdir -p /root/.config/code-server "${CODE_SERVER_EXTENSIONS_DIR}"

if [ -d "${OFFLINE_VSIX_DIR}" ]; then
    find "${OFFLINE_VSIX_DIR}" -maxdepth 1 -type f \( -name '*.vsix' -o -name '*.VSIX' \) | sort | while read -r vsix; do
        [ -n "${vsix}" ] || continue
        echo "Installing offline VSIX: $(basename "${vsix}")"
        code-server --install-extension "${vsix}" --extensions-dir "${CODE_SERVER_EXTENSIONS_DIR}" --force
    done
fi

code-server --auth password --bind-addr 0.0.0.0:8000 --abs-proxy-base-path "/${APP_NAME}-ide" --extensions-dir "${CODE_SERVER_EXTENSIONS_DIR}" /app &
exec uvicorn app:app --host 0.0.0.0 --port 80 --reload
EOF
RUN chmod +x /usr/local/bin/start-app.sh

# Setup python environment
WORKDIR /app
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy application files
COPY . .

# Create uploads directory
RUN mkdir -p uploads

# APP_NAME is passed at runtime by the manager (e.g. "myapp")
ENV APP_NAME=app

# Start both FastAPI and code-server
# Any .vsix files mounted at /opt/offline-vsix are installed before code-server starts.
CMD ["/usr/local/bin/start-app.sh"]
