FROM node:22-alpine
LABEL org.opencontainers.image.source=https://github.com/mnbny/moonbunny-host
COPY server/server.bundle.mjs /server.mjs
VOLUME /data
EXPOSE 8080
CMD ["node", "/server.mjs"]
