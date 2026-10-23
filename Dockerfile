FROM node:20-alpine AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm install
COPY web .
RUN npm run build
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
COPY --from=web /web/dist ./web/dist
EXPOSE 3000
CMD ["sh","-c","npm run migrate && npm start"]
