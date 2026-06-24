# Stage 1: build the React client
FROM node:20-alpine AS builder
WORKDIR /build

# Install client deps (npm used here; avoids pnpm dev-machine quirks)
COPY client/package.json ./client/
RUN cd client && npm install

COPY client/index.html client/vite.config.js ./client/
COPY client/src ./client/src
RUN cd client && npm run build


# Stage 2: production image
FROM node:20-alpine
WORKDIR /app

# Install server deps (production only)
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm install --omit=dev 2>/dev/null || npm install --production

COPY server/index.js ./server/

# Built frontend from stage 1
COPY --from=builder /build/client/dist ./client/dist

RUN mkdir -p server/uploads server/avatars

EXPOSE 3001

ENV PORT=3001
ENV NODE_ENV=production

CMD ["node", "server/index.js"]
