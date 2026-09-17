# Worker-Image. Build-Kontext ist das Repo-Wurzelverzeichnis, weil shared/ gebraucht wird:
#   docker build -f worker/Dockerfile -t signal-worker .
#   docker run --rm --env-file worker/.env signal-worker
FROM node:22-alpine

WORKDIR /app/worker
ENV NODE_ENV=production

COPY worker/package.json worker/package-lock.json ./
# tsx führt die TypeScript-Quellen direkt aus, deshalb werden die Dev-Abhängigkeiten mitinstalliert.
RUN npm ci --include=dev && npm cache clean --force

COPY shared /app/shared
COPY worker/tsconfig.json ./
COPY worker/src ./src

USER node
CMD ["npm", "start"]
