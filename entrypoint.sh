#!/bin/bash
set -e

# Configure Docker daemon
mkdir -p /etc/docker
cat <<EOF > /etc/docker/daemon.json
{
  "dns": ["8.8.8.8", "8.8.4.4"],
  "mtu": 1400
}
EOF
cat <<EOF > /etc/docker/daemon.json
{
  "dns": ["8.8.8.8", "8.8.4.4"],
  "mtu": 1400
}
EOF

echo "Starting Docker daemon in background..."
dockerd-entrypoint.sh dockerd > /var/log/dockerd.log 2>&1 &
sleep 5

echo "Creating internal Docker network if it doesn't exist..."
docker network create mcp-net || true

echo "Starting Traefik..."
docker rm -f traefik || true
# Ensure the image is present or use host DNS? Actually, DinD network might need a custom nameserver or we might need to use host network.
# Let's try to pass --dns 8.8.8.8 to dockerd.
docker run -d \
  --name traefik \
  --network mcp-net \
  -p 8080:80 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  traefik:v3.0 \
  --api.insecure=true \
  --providers.docker=true \
  --providers.docker.exposedbydefault=false

echo "Starting Rust Management UI..."
/manager/manager-ui &

echo "Starting Python MCP Server..."
# Run MCP server in foreground to keep container alive
python3 mcp_server.py
