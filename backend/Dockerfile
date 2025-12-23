# Use Debian-based Node so we can apt-get Chrome deps
FROM node:20-bullseye

# Create non-root user for security
RUN groupadd -r user1 && useradd -r -g user1 -G audio,video user1 \
    && mkdir -p /home/user1/.cache/puppeteer \
    && mkdir -p /home/user1/.cache/privy/profiles \
    && mkdir -p /home/user1/.cache/deal-finder/shared-profile \
    && chown -R user1:user1 /home/user1

# Puppeteer/Chromium dependencies + Google Chrome
RUN apt-get update && apt-get install -y \
    ca-certificates fonts-liberation libasound2 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libgbm1 libgtk-3-0 libnspr4 libnss3 libx11-6 libx11-xcb1 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libxrender1 libxshmfence1 \
    wget xdg-utils gnupg curl \
  && rm -rf /var/lib/apt/lists/*

# Install Google Chrome Stable
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set Chrome environment variables
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome
ENV CHROME_PATH=/usr/bin/google-chrome
ENV PUPPETEER_SKIP_DOWNLOAD=1

# App
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Environment (PORT defaults in your code to 3015)
ENV NODE_ENV=production

# Create directories for temp files and give proper permissions
RUN mkdir -p /tmp/bofa_debug /tmp/price_sync_debug \
    && chown -R user1:user1 /app /tmp/bofa_debug /tmp/price_sync_debug

# Switch to non-root user
USER user1

# Health check (optional)
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
 CMD node -e "fetch('http://localhost:3015/api').then(()=>process.exit(0)).catch(()=>process.exit(1))" || exit 1

EXPOSE 3015
CMD ["node", "start-combined.js"]