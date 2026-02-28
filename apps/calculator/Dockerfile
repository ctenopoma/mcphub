FROM python:3.11-slim
ENV PASSWORD=mcp-ide-pass
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://code-server.dev/install.sh | sh
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
CMD code-server --bind-addr 0.0.0.0:8000 /app & uvicorn app:app --host 0.0.0.0 --port 80 --reload
