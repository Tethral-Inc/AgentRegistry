FROM node:20-slim

WORKDIR /app

# Install the package from npm
RUN npm install -g @tethral/acr-mcp

# HTTP transport defaults
ENV ACR_MCP_HTTP_PORT=3001
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3001/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["acr-mcp-http"]
