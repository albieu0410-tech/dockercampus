use axum::{
    Router,
    http::Method,
};
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use tower_http::cors::{CorsLayer, Any};
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use dotenv::dotenv;
use std::env;

mod db;
mod models;
mod handlers;
mod docker;
mod errors;
mod state;

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

    let database_url = env::var("DATABASE_URL")
        .expect("DATABASE_URL must be set");

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&database_url)
        .await?;

    info!("Connected to PostgreSQL");

    sqlx::migrate!("src/db/migrations")
        .run(&pool)
        .await?;

    info!("Migrations ran successfully");

    let docker_manager = docker::manager::DockerManager::new().await?;

    info!("Connected to Docker daemon");

    let state = Arc::new(AppState {
        db: pool,
        docker: docker_manager,
    });

    let cors = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::PUT])
        .allow_origin(Any)
        .allow_headers(Any);

    let app = Router::new()
        .nest("/containers", handlers::containers::router())
        .nest("/deployments", handlers::deployments::router())
        .nest("/monitor", handlers::monitor::router())
        .layer(cors)
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8001").await?;

    info!("Container engine listening on port 8001");

    axum::serve(listener, app).await?;

    Ok(())
}
