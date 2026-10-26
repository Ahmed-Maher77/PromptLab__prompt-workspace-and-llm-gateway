# Stage 1: Build the Angular web app (fonts are self-hosted, no network access needed at build time)
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

RUN npm ci --workspace=@promptlab/web

COPY apps/web ./apps/web

RUN npm --workspace=@promptlab/web run build -- --configuration production

# Stage 2: Serve static files with unprivileged Nginx
FROM nginxinc/nginx-unprivileged:alpine AS runner

COPY --chown=nginx:nginx apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chown=nginx:nginx --from=builder /app/apps/web/dist/web/browser /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
