ARG BASE_IMAGE=docker.io/library/node@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0
FROM ${BASE_IMAGE} AS builder
ENV NODE_ENV=development
WORKDIR /build
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
FROM ${BASE_IMAGE}
WORKDIR /app
RUN adduser --disabled-password --gecos "" appuser
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /build/dist ./dist
ENV APP_ENV=production APP_PORT=8012 MONGODB_DATABASE=fedops-registry
USER appuser
EXPOSE 8012
CMD ["node", "dist/main"]
