FROM rust:latest as builder
WORKDIR /app
COPY Cargo.toml ./
RUN cargo fetch
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y libssl3 ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/container-engine .
COPY --from=builder /app/src/db/migrations ./src/db/migrations
CMD ["./container-engine"]