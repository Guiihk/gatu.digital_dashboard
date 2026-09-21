FROM node:22-alpine

ARG APP_RELEASE=20260910-2305

WORKDIR /app
COPY . .

ENV NODE_ENV=production
ENV PORT=4173
EXPOSE 4173

CMD ["node", "server.cjs"]
