FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/client/package.json packages/client/package.json
COPY examples/browser/package.json examples/browser/package.json
RUN npm ci
COPY packages/client packages/client
COPY examples/browser examples/browser
RUN npm run build -w packages/client
WORKDIR /app/examples/browser
CMD ["npm","run","dev"]
