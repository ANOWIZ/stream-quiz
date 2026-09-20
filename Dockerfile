FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci && npm run db:generate
COPY . .
RUN npm run build && mkdir -p data uploads backups && chown -R node:node /app
ENV NODE_ENV=production PORT=3001 DATABASE_URL=file:/app/data/quiz.db
USER node
EXPOSE 3001
CMD ["sh", "-c", "npm run db:push && npm start"]
