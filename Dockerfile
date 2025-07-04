# Metabase MCP Server Dockerfile
# Base image: Node.js LTS Alpine for minimum footprint

FROM node:lts-alpine

LABEL maintainer="Jericho Sequitin <https://github.com/jerichosequitin>"
LABEL description="Model Context Protocol server for Metabase"
LABEL version="0.1.0"

# Set working directory
WORKDIR /usr/src/app

# Copy package files first to leverage Docker layer caching
COPY package*.json ./

# Configure npm to skip prepare scripts during install
RUN npm config set ignore-scripts true

# Install all dependencies including devDependencies for build
RUN npm ci

# Restore the ignore-scripts setting
RUN npm config set ignore-scripts false

# Copy application code
COPY . .

# Run comprehensive tests during build
RUN npm run test:coverage

# Build the TypeScript project (without running tests again)
RUN npm run build:fast

# Set appropriate permissions for the executable
RUN chmod +x build/src/index.js

# Clean up dev dependencies to reduce image size
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Default environment variables
ENV NODE_ENV=production \
    LOG_LEVEL=info

# Authentication setup (configure via Docker run -e flags)
# Option 1: Username and password authentication
# docker run -e METABASE_URL=https://metabase.example.com -e METABASE_USER_EMAIL=user@example.com -e METABASE_PASSWORD=pass metabase-mcp

# Option 2: API Key authentication (recommended for production)
# docker run -e METABASE_URL=https://metabase.example.com -e METABASE_API_KEY=your_api_key metabase-mcp

# Use non-root user for better security
USER node

# Run the server
CMD ["node", "build/src/index.js"]
