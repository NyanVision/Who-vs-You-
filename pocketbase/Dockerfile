FROM alpine:3.22

ARG PB_VERSION=0.40.4

RUN apk add --no-cache unzip ca-certificates \
  && addgroup -S pocketbase \
  && adduser -S -G pocketbase pocketbase

ADD https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip /tmp/pb.zip
RUN mkdir -p /pb/pb_data /pb/pb_migrations \
  && unzip /tmp/pb.zip -d /pb \
  && rm /tmp/pb.zip \
  && chown -R pocketbase:pocketbase /pb

COPY --chown=pocketbase:pocketbase pb_migrations /pb/pb_migrations

USER pocketbase
WORKDIR /pb
EXPOSE 8080

CMD ["/bin/sh", "-c", "/pb/pocketbase serve --http=0.0.0.0:${PORT:-8080}"]
