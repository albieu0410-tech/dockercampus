use utoipa::openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme};
use utoipa::{Modify, OpenApi};

use crate::handlers;

struct SecurityAddon;

impl Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        if let Some(components) = openapi.components.as_mut() {
            components.add_security_scheme(
                "bearerAuth",
                SecurityScheme::Http(
                    HttpBuilder::new()
                        .scheme(HttpAuthScheme::Bearer)
                        .bearer_format("JWT")
                        .build(),
                ),
            );
        }
    }
}

#[derive(OpenApi)]
#[openapi(
    info(
        title = "DockCampus Container Engine API",
        description = "Auth, container orchestration, deployments, and hive management API.",
        version = env!("CARGO_PKG_VERSION")
    ),
    modifiers(&SecurityAddon),
    tags(
        (name = "auth", description = "Registration, login, OTP, password reset, invite codes"),
        (name = "github", description = "GitHub OAuth connection and repo browsing"),
        (name = "users", description = "User profile and admin user management"),
        (name = "classes", description = "Professor classes and student membership"),
        (name = "containers", description = "Student container lifecycle and code-server proxy"),
        (name = "deployments", description = "Student repo build and deploy pipeline"),
        (name = "hive", description = "Worker node registration and metrics"),
        (name = "wireguard", description = "WireGuard peer configuration"),
        (name = "routing", description = "Load balancing strategy and routing decisions"),
        (name = "sleep", description = "Idle container sleep manager"),
        (name = "jobs", description = "Background job queue"),
        (name = "resources", description = "Disk and Docker resource cleanup"),
        (name = "monitor", description = "System and container statistics"),
        (name = "health", description = "Health checks")
    ),
    paths(
        handlers::health::health,
        handlers::monitor::get_stats,
        handlers::monitor::health_check,
        handlers::resources::get_storage_breakdown,
        handlers::resources::cleanup_resources,
        handlers::sleep::status,
        handlers::sleep::run_once,
        handlers::sleep::candidates,
        handlers::jobs::list_jobs,
        handlers::jobs::create_job,
        handlers::jobs::retry_job,
        handlers::jobs::cancel_job,
        handlers::auth::health,
        handlers::auth::register,
        handlers::auth::login,
        handlers::auth::verify_otp,
        handlers::auth::forgot_password,
        handlers::auth::reset_password,
        handlers::auth::create_invite_code,
        handlers::auth::list_invite_codes,
        handlers::users::get_me,
        handlers::users::update_profile,
        handlers::users::change_password,
        handlers::users::delete_account,
        handlers::users::list_users,
        handlers::users::list_students,
        handlers::users::update_user,
        handlers::classes::create_class,
        handlers::classes::list_classes,
        handlers::classes::get_class,
        handlers::classes::update_class,
        handlers::classes::delete_class,
        handlers::classes::list_class_students,
        handlers::classes::add_student_to_class,
        handlers::classes::remove_student_from_class,
        handlers::hive::list_nodes,
        handlers::hive::join_info,
        handlers::hive::join_hive,
        handlers::hive::heartbeat,
        handlers::routing::get_state,
        handlers::routing::set_strategy,
        handlers::routing::set_canary,
        handlers::routing::update_node_metrics,
        handlers::routing::set_circuit_state,
        handlers::routing::decide_route,
        handlers::wireguard::get_status,
        handlers::wireguard::list_peers,
        handlers::wireguard::upsert_peer,
        handlers::wireguard::update_peer,
        handlers::wireguard::record_handshake,
        handlers::deployments::create_deployment,
        handlers::deployments::list_deployments,
        handlers::deployments::get_deployment,
        handlers::deployments::cancel_deployment,
        handlers::deployments::build_image,
        handlers::deployments::run_container,
        handlers::github::github_login,
        handlers::github::github_callback,
        handlers::github::github_status,
        handlers::github::list_repos,
        handlers::github::get_repo_tree,
        handlers::github::get_file_content,
        handlers::containers::list_containers,
        handlers::containers::create_container,
        handlers::containers::start_container,
        handlers::containers::wake_container,
        handlers::containers::stop_container,
        handlers::containers::delete_container,
        handlers::containers::get_container_stats,
        handlers::containers::exec_in_container,
        handlers::containers::proxy_container_root_get,
        handlers::containers::proxy_to_container_http,
        handlers::containers::proxy_or_ws_to_container_get
    ),
    components(schemas(crate::errors::ErrorResponse))
)]
pub struct ApiDoc;
