# Dockerfile for scraper service in monorepo with tsx
# Build context: project root (.) - Railway will set this correctly
FROM node:20-alpine

WORKDIR /app

# Install Chromium and dependencies first
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Set Puppeteer to use system Chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Copy root package.json and lock file for workspace setup
COPY package.json package-lock.json ./

# Copy workspace packages
COPY packages ./packages
COPY apps/scraper ./apps/scraper

# Install dependencies for entire workspace
RUN npm ci

# Build only the database package (required for scraper)
RUN npm run build -w @10s/database

# Note: .env should be set via Railway environment variables, not copied

# Run as non-root user for security
RUN addgroup -g 1001 -S scraper && \
    adduser -S scraper -u 1001 && \
    chown -R scraper:scraper /app

USER scraper

WORKDIR /app/apps/scraper

# Start the service with tsx (runs TypeScript directly)
CMD ["npm", "start"]
