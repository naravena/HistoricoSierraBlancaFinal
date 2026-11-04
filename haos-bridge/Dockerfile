FROM node:22-alpine
WORKDIR /app
RUN npm install --omit=dev --no-audit --no-fund express@4.21.2 express-rate-limit@7.5.1
COPY bridge.js history.js summary.js ./
CMD ["node", "bridge.js"]
