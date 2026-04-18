FROM rust:1.86 as builder
WORKDIR /app
COPY Cargo.toml ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
WORKDIR /app
COPY --from=builder /app/target/release/container-engine /usr/local/bin/container-engine
EXPOSE 8080
CMD ["container-engine"]
