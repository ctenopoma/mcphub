#!/bin/bash
set -e

# Ensure iptables forwarding for Docker networking
iptables -P FORWARD ACCEPT 2>/dev/null || true

# Write daemon.json for DNS resolution inside DinD
mkdir -p /etc/docker
cat <<'EOF' > /etc/docker/daemon.json
{
  "dns": ["8.8.8.8", "8.8.4.4"],
  "mtu": 1400,
  "storage-driver": "overlay2"
}
EOF

echo "Starting Docker daemon in background..."
dockerd > /var/log/dockerd.log 2>&1 &

# Wait for Docker daemon to be ready
echo "Waiting for Docker daemon..."
for i in $(seq 1 30); do
  if docker info > /dev/null 2>&1; then
    echo "Docker daemon is ready."
    break
  fi
  sleep 1
done

echo "Creating internal Docker network..."
docker network create mcp-net || true

echo "Starting Traefik..."
docker rm -f traefik 2>/dev/null || true
docker run -d \
  --name traefik \
  --network mcp-net \
  -p 8080:80 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  traefik:v3.0 \
  --api.insecure=true \
  --providers.docker=true \
  --providers.docker.exposedbydefault=false

UI_PORT="${UI_PORT:-8081}"
MCP_PORT="${MCP_PORT:-8000}"
MANAGER_PASSWORD="${MANAGER_PASSWORD:-mcp-hub-password}"

# Detect DinD bridge gateway IP (how Traefik containers reach this host)
MANAGER_IP=$(docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}' 2>/dev/null || echo "172.17.0.1")
echo "Detected MANAGER_IP: ${MANAGER_IP}"

echo "Starting Rust Management UI on port ${UI_PORT}..."
HOST=0.0.0.0 UI_PORT="${UI_PORT}" MANAGER_PASSWORD="${MANAGER_PASSWORD}" MANAGER_IP="${MANAGER_IP}" /manager/manager-ui &

echo "Starting Python MCP Server on port ${MCP_PORT}..."
MCP_PORT="${MCP_PORT}" python3 mcp_server.py
