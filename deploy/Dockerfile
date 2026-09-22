FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY packages/gateway/package.json packages/gateway/package.json
COPY packages/eval/package.json packages/eval/package.json
RUN npm ci
COPY tsconfig.json ./
COPY packages ./packages
RUN npm run build

FROM node:22-alpine
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/gateway ./packages/gateway
USER app
EXPOSE 4318
ENTRYPOINT ["node", "packages/gateway/dist/cli.js", "serve"]
CMD ["--config", "/config/gateway.yaml"]
