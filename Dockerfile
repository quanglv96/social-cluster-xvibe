FROM mcr.microsoft.com/playwright:v1.58.2-jammy

WORKDIR /app

ENV NODE_ENV=production
ENV TZ=Asia/Ho_Chi_Minh

RUN apt-get update && apt-get install -y dumb-init

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force


COPY . .

EXPOSE 3001

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/trigger-server.js"]
