use axum::{
    http::{HeaderValue, Method},
    Router,
};
use dotenv::dotenv;
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod auth;
mod config;
mod db;
mod docker;
mod errors;
mod handlers;
mod jobs;
mod middleware;
mod models;
mod sleep;
mod state;
mod wireguard;

pub use state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenv().ok();

    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "container_engine=debug".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    info!("Starting DockCampus container engine...");

    let config = config::Config::from_env()?;

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&config.database_url)
        .await?;

    info!("Connected to PostgreSQL");

    sqlx::migrate!("src/db/migrations").run(&pool).await?;

    info!("Migrations ran successfully");

    let docker_manager = docker::manager::DockerManager::new().await?;

    info!("Connected to Docker daemon");

    let http_client = reqwest::Client::new();
    let state = Arc::new(AppState {
        db: pool,
        docker: docker_manager,
        config: config.clone(),
        http_client,
    });
    sleep::spawn_manager(state.clone());

    let cors_base = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::PUT])
        .allow_headers(Any);
    let cors = if config.allowed_origins.iter().any(|origin| origin == "*") {
        cors_base.allow_origin(Any)
    } else {
        let allowed_origins: Vec<HeaderValue> = config
            .allowed_origins
            .iter()
            .filter_map(|origin| origin.parse::<HeaderValue>().ok())
            .collect();
        cors_base.allow_origin(allowed_origins)
    };

    let app = Router::new()
        .nest("/auth", handlers::auth::router())
        .nest("/auth/github", handlers::github::router())
        .nest("/users", handlers::users::router())
        .nest("/classes", handlers::classes::router())
        .nest("/hive", handlers::hive::router())
        .nest("/wireguard", handlers::wireguard::router())
        .nest("/routing", handlers::routing::router())
        .nest("/resources", handlers::resources::router())
        .nest("/sleep", handlers::sleep::router())
        .nest("/jobs", handlers::jobs::router())
        .nest("/health", handlers::health::router())
        .nest("/containers", handlers::containers::router())
        .nest("/deployments", handlers::deployments::router())
        .nest("/monitor", handlers::monitor::router())
        .layer(cors)
        .with_state(state);

    let bind_address = format!("0.0.0.0:{}", config.port);
    let listener = tokio::net::TcpListener::bind(&bind_address).await?;

    info!("Container engine listening on {}", bind_address);

    axum::serve(listener, app).await?;

    Ok(())
}
