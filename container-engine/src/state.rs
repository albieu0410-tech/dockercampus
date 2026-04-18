use crate::docker::manager::DockerManager;

pub struct AppState {
    pub db: sqlx::PgPool,
    pub docker: DockerManager,
}
