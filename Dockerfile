FROM node:22-alpine
COPY server/server.bundle.mjs /server.mjs
VOLUME /data
EXPOSE 8080
CMD ["node", "/server.mjs"]
