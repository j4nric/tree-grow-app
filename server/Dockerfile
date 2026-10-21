# Sync-Server für „Vom Samen zum Wald“ – Node 22, SQLite über node:sqlite (keine nativen Pakete).
# Bauen: docker build -t vszw-sync server/   (oder über deploy/docker-compose.yml)

# Feste Version (Updates bewusst: Tag hier anheben).
FROM node:22.22.3-alpine3.24 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22.22.3-alpine3.24
ENV NODE_ENV=production \
    PORT=8787 \
    DB_PATH=/data/saves.db \
    BACKUP_DIR=/data/backups
WORKDIR /app
# Keine Laufzeit-Abhängigkeiten: nur das übersetzte JavaScript (dist/index.js = Server,
# dist/admin-cli.js = Verwaltung: users | delete-user <name> | backup).
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/index.js"]
