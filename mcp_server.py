import asyncio
import os
import httpx
import docker
from typing import Dict, Any, List
from mcp.server.fastmcp import FastMCP

# Initialize FastMCP server
mcp = FastMCP("DinD Dynamic Manager")

# Configuration from environment variables
TRAEFIK_INTERNAL_PORT = 8080  # Always 8080 inside the container (Traefik's mapped port)
MCP_PORT = int(os.environ.get("MCP_PORT", "8000"))

# Initialize Docker client
try:
    docker_client = docker.from_env()
except Exception as e:
    print(f"Failed to connect to Docker daemon: {e}")
    docker_client = None

# Store registered tools to track what we've added
_registered_tool_names = set()

async def fetch_openapi_schema(app_name: str) -> Dict[str, Any]:
    """Fetch OpenAPI schema from a running container's API via Traefik."""
    url = f"http://localhost:{TRAEFIK_INTERNAL_PORT}/{app_name}/openapi.json"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(url)
            if response.status_code == 200:
                print(f"Successfully fetched schema for {app_name}")
                return response.json()
    except Exception as e:
        print(f"Failed to fetch schema for {app_name}: {e}")
    return {}

def create_dynamic_tool(app_name: str, path: str, method: str, operation: Dict[str, Any]):
    """Create a unique tool function natively for FastMCP, dynamically built from the OpenAPI operation."""
    op_id = operation.get("operationId", f"{method}_{path.replace('/', '_').strip('_')}")
    tool_name = f"{app_name}_{op_id}"
    
    if tool_name in _registered_tool_names:
        return
    
    description = operation.get("summary", f"Auto-generated tool for {app_name} {method.upper()} {path}")
    
    async def dynamic_tool_func(payload: Dict[str, Any] = None) -> Any:
        url = f"http://localhost:{TRAEFIK_INTERNAL_PORT}/{app_name}{path}"
        async with httpx.AsyncClient() as client:
            if method.lower() == "get":
                res = await client.get(url, params=payload)
            elif method.lower() == "post":
                if "upload" in path.lower() or "file" in path.lower():
                     if payload and "file_path" in payload:
                         file_path = payload["file_path"]
                         with open(file_path, "rb") as f:
                             files = {"file": f}
                             res = await client.post(url, files=files)
                     else:
                        return {"error": "Missing file_path in payload for upload."}
                else:
                    res = await client.post(url, json=payload)
            elif method.lower() == "put":
                res = await client.put(url, json=payload)
            elif method.lower() == "delete":
                res = await client.delete(url, params=payload)
            else:
                 return {"error": f"Unsupported method {method}"}
            
            try:
                return res.json()
            except:
                return res.text

    dynamic_tool_func.__name__ = tool_name
    dynamic_tool_func.__doc__ = description
    
    mcp.tool()(dynamic_tool_func)
    _registered_tool_names.add(tool_name)
    print(f"Registered dynamic tool: {tool_name}")

async def discover_and_register_tools():
    """Discover running containers and register their APIs as MCP tools."""
    if not docker_client:
        return
        
    while True:
        try:
            containers = docker_client.containers.list()
            for container in containers:
                name = container.name
                if name in ["mcp-manager", "traefik"]:
                    continue
                    
                schema = await fetch_openapi_schema(name)
                if schema and "paths" in schema:
                    for path, path_item in schema["paths"].items():
                        for method, operation in path_item.items():
                            create_dynamic_tool(name, path, method, operation)
        except Exception as e:
            print(f"Error during discovery: {e}")
            
        await asyncio.sleep(15)

@mcp.tool()
async def list_registered_tools() -> List[str]:
    """List all currently registered dynamic MCP tools."""
    return list(_registered_tool_names)

def main():
    print(f"Starting DinD MCP Server on port {MCP_PORT}...")
    
    import threading
    def run_discovery():
        asyncio.run(discover_and_register_tools())
        
    discovery_thread = threading.Thread(target=run_discovery, daemon=True)
    discovery_thread.start()

    mcp.settings.host = "0.0.0.0"
    mcp.settings.port = MCP_PORT
    mcp.run(transport='sse')

if __name__ == "__main__":
    main()
