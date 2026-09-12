FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
COPY docs ./docs
RUN mkdir /app/data && chown node:node /app/data
USER node
ENV CITEFLOW_HOST=0.0.0.0 PORT=3210 CITEFLOW_DB=/app/data/citeflow.sqlite
EXPOSE 3210
CMD ["node","src/server.js"]
