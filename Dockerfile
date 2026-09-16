FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:24-alpine AS runtime
RUN apk add --no-cache openssh-client
WORKDIR /app
ENV NODE_ENV=production \
    DASHBOARD_HOST=0.0.0.0 \
    DASHBOARD_PORT=3100 \
    SSH_NEXUS_CONFIG=/home/node/.ssh/config \
    PROJECT_ROOTS=/workspace
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
RUN mkdir -p /data/ssh && chown -R node:node /data
USER node
EXPOSE 3100
CMD ["node", "dist/server/dashboard-server.js"]
