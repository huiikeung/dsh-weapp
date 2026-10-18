FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node server.cjs console.cjs connector.cjs durations.cjs engagement.cjs announcements.cjs ./
COPY --chown=node:node web ./web
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV NODE_ENV=production ACCESS_HOST=0.0.0.0 ACCESS_PORT=8790 ACCESS_STATE_FILE=/app/data/state.json
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:8790/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.cjs"]
