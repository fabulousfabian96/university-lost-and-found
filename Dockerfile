FROM node:20-alpine

WORKDIR /usr/src/app

COPY package.json package-lock.json* ./
RUN npm install

COPY . ./

RUN mkdir -p /usr/src/app/public/uploads

EXPOSE 3000

CMD ["node", "server.js"]
