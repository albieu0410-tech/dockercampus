use base64::{engine::general_purpose::STANDARD, Engine as _};
use rand_core::{OsRng, RngCore};

#[derive(Debug, Clone)]
pub struct WireGuardManager {
    pub interface: String,
    pub network_cidr: String,
    pub listen_port: u16,
    pub private_key: Option<String>,
    pub public_key: Option<String>,
}

#[derive(Debug, Clone)]
pub struct WireGuardStatus {
    pub enabled: bool,
    pub configured: bool,
    pub interface: String,
    pub network_cidr: String,
    pub listen_port: u16,
    pub has_private_key: bool,
    pub has_public_key: bool,
}

impl WireGuardManager {
    pub fn from_env() -> Self {
        Self {
            interface: std::env::var("WIREGUARD_INTERFACE").unwrap_or_else(|_| "wg0".to_string()),
            network_cidr: std::env::var("WIREGUARD_NETWORK_CIDR")
                .unwrap_or_else(|_| "10.10.0.0/24".to_string()),
            listen_port: std::env::var("WIREGUARD_LISTEN_PORT")
                .ok()
                .and_then(|v| v.parse::<u16>().ok())
                .unwrap_or(51820),
            private_key: env_opt("WIREGUARD_PRIVATE_KEY"),
            public_key: env_opt("WIREGUARD_PUBLIC_KEY"),
        }
    }

    pub fn status(&self) -> WireGuardStatus {
        let has_private_key = self.private_key.as_ref().is_some();
        let has_public_key = self.public_key.as_ref().is_some();

        WireGuardStatus {
            enabled: has_private_key && has_public_key,
            configured: has_private_key && has_public_key,
            interface: self.interface.clone(),
            network_cidr: self.network_cidr.clone(),
            listen_port: self.listen_port,
            has_private_key,
            has_public_key,
        }
    }

    pub fn generate_preshared_key() -> String {
        let mut psk = [0_u8; 32];
        OsRng.fill_bytes(&mut psk);
        STANDARD.encode(psk)
    }
}

fn env_opt(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

pub fn is_valid_key(key: &str) -> bool {
    let decoded = STANDARD.decode(key.as_bytes());
    match decoded {
        Ok(bytes) => bytes.len() == 32,
        Err(_) => false,
    }
}
