FROM node:24.21.0-alpine AS dependencies
RUN corepack enable && corepack prepare pnpm@12.10.1 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

FROM dependencies AS production-dependencies
RUN pnpm prune --prod

FROM node:24.21.0-alpine AS runtime
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S -G app app
WORKDIR /app
COPY package.json ./
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER app
EXPOSE 3000
CMD ["node", "dist/main.js"]
