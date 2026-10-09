FROM node:22-slim

ENV NODE_ENV=production \
    PORT=8787

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@12.8.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --chown=node:node src ./src
COPY --chown=node:node prototype ./prototype
COPY --chown=node:node fixtures ./fixtures

RUN mkdir -p /app/data/snapshots && chown -R node:node /app/data

USER node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/health`).then((r)=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["./node_modules/.bin/tsx", "src/main.ts"]
