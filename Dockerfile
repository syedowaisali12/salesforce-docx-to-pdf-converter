FROM ubuntu:22.04

RUN apt-get update && \
    apt-get install -y libreoffice curl nodejs npm && \
    apt-get clean

WORKDIR /app

COPY . .

RUN npm install

EXPOSE 3000

CMD ["node", "index.js"]
