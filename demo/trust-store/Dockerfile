# Self-contained trust store: builds UOR-Foundation/kappa-registry from source.
# Used only when no Rust toolchain is available on the host.
FROM rust:1-bookworm AS build
ARG KAPPA_REF=main
RUN git clone --depth 1 --branch "${KAPPA_REF}" \
      https://github.com/UOR-Foundation/kappa-registry /src || \
    git clone --depth 1 https://github.com/UOR-Foundation/kappa-registry /src
WORKDIR /src
RUN cargo build --release

FROM debian:bookworm-slim
RUN useradd -m app
COPY --from=build /src/target/release/kappa-registry /usr/local/bin/kappa-registry
USER app
ENV KAPPA_STORE_ROOT=/data KAPPA_LISTEN_ADDR=0.0.0.0:8080
VOLUME ["/data"]
EXPOSE 8080
ENTRYPOINT ["kappa-registry"]
