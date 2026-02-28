FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

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
# code-server uses --abs-proxy-base-path so it works behind Traefik at /<APP_NAME>-ide/
CMD code-server --auth password --bind-addr 0.0.0.0:8000 --abs-proxy-base-path /${APP_NAME}-ide /app & \
    uvicorn app:app --host 0.0.0.0 --port 80 --reload
