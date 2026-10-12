# Keep a client compatible with Synology's older Docker daemon; the helper does
# not install or upgrade Docker Engine on the host.
FROM docker:28.5.2-cli AS docker-client
FROM node:24-alpine
COPY --from=docker-client /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-client /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
RUN apk add --no-cache flock
WORKDIR /app
COPY cli.mjs docker.mjs runner.mjs protocol.mjs ./
ENV UPDATER_STATE_DIR=/state
VOLUME /state
CMD ["sh", "-c", "mkdir -p /state && chmod 700 /state && exec flock -n /state/updater.lock node /app/cli.mjs"]
