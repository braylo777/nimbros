# nimbros-indexer: build once, run anywhere a container runs (Fly.io, Railway, a VPS).
FROM rust:1-slim AS build
WORKDIR /src
COPY . .
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config ca-certificates && apt-get clean
RUN cargo build --release -p nimbros-indexer

FROM debian:stable-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && apt-get clean
COPY --from=build /src/target/release/nimbros-indexer /usr/local/bin/nimbros-indexer
ENV PORT=8080 INDEXER_DB=/data/indexer.db
VOLUME /data
EXPOSE 8080
CMD ["nimbros-indexer"]
