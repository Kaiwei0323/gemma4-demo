FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache postgresql-client

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY . .

RUN chmod +x /app/docker-entrypoint.sh

ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

CMD ["/app/docker-entrypoint.sh"]

