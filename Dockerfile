FROM node:20-alpine

WORKDIR /app

# Install dependencies first (better cache layer)
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Copy app files
COPY . .

# Create data directory
RUN mkdir -p /app/data

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

# Start app
CMD ["node", "server.js"]
