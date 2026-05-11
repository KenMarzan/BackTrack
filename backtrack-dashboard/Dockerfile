FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM bitnami/kubectl:latest AS kubectl
FROM docker:latest AS docker-cli

FROM node:20-alpine AS runner
WORKDIR /app

# Copy binaries from official images — no apk needed
COPY --from=kubectl /opt/bitnami/kubectl/bin/kubectl /usr/local/bin/kubectl
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker

ENV NODE_ENV=production
ENV PORT=3847
ENV HOSTNAME=0.0.0.0

# Pre-configured SMTP — works out of the box when pulled from Docker Hub.
# Override any of these at runtime via docker-compose or docker run -e.
ENV BACKTRACK_SMTP_HOST=smtp.gmail.com
ENV BACKTRACK_SMTP_PORT=587
ENV BACKTRACK_SMTP_USER=marzanken232@gmail.com
ENV BACKTRACK_SMTP_PASS="eazb hsmi xnme wmyh"
ENV BACKTRACK_SMTP_FROM=marzanken232@gmail.com

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3847
CMD ["node", "server.js"]



