FROM node:22-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY relay-server.js public-access.js ./
RUN mkdir -p /app/data && chown -R node:node /app

USER node
ENV NODE_ENV=production RELAY_HOST=0.0.0.0 RELAY_PORT=8787 RELAY_STATE_FILE=/app/data/relay-state.json
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "relay-server.js"]
