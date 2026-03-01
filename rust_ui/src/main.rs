use axum::{
    extract::{Path, State},
    http::{HeaderMap, Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use axum_extra::extract::cookie::{Cookie, CookieJar};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Command;
use std::sync::{Arc, RwLock};
use tower_http::services::{ServeDir, ServeFile};
use std::fs;

// ── Data structures ──

#[derive(Serialize)]
struct AppStatus {
    name: String,
    status: String,
    auth_type: String,
}

#[derive(Deserialize)]
struct LoginRequest {
    password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "auth_type")]
enum AuthAppConfig {
    #[serde(rename = "none")]
    None,
    #[serde(rename = "api_key")]
    ApiKey { api_key: String },
    #[serde(rename = "entra_id")]
    EntraId { tenant_id: String, client_id: String },
}

#[derive(Clone)]
struct JwksCache {
    keys: jsonwebtoken::jwk::JwkSet,
    fetched_at: std::time::Instant,
    tenant_id: String,
}

#[derive(Clone)]
struct AppState {
    session_secret: String,
    manager_password: String,
    auth_config: Arc<RwLock<HashMap<String, AuthAppConfig>>>,
    jwks_cache: Arc<RwLock<Option<JwksCache>>>,
    manager_ip: String,
}

// ── Auth config persistence ──

const AUTH_CONFIG_PATH: &str = "/apps/auth_config.json";

fn load_auth_config() -> HashMap<String, AuthAppConfig> {
    match fs::read_to_string(AUTH_CONFIG_PATH) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => HashMap::new(),
    }
}

fn save_auth_config(config: &HashMap<String, AuthAppConfig>) -> Result<(), std::io::Error> {
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    fs::write(AUTH_CONFIG_PATH, json)
}

// ── Session helpers ──

fn generate_session_token(secret: &str, password: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    secret.hash(&mut hasher);
    password.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

// ── Dashboard auth middleware ──

async fn auth_middleware(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
    request: Request<axum::body::Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    let expected = generate_session_token(&state.session_secret, &state.manager_password);
    match jar.get("mcphub_session") {
        Some(cookie) if cookie.value() == expected => Ok(next.run(request).await),
        _ => Err(StatusCode::UNAUTHORIZED),
    }
}

// ── Main ──

#[tokio::main]
async fn main() {
    let manager_password = std::env::var("MANAGER_PASSWORD")
        .unwrap_or_else(|_| "mcp-hub-password".to_string());

    let manager_ip = std::env::var("MANAGER_IP")
        .unwrap_or_else(|_| "172.17.0.1".to_string());

    let session_secret = format!("{:016x}", rand::random::<u64>());

    let auth_config = load_auth_config();
    println!("Loaded auth config with {} app entries", auth_config.len());

    let state = Arc::new(AppState {
        session_secret,
        manager_password,
        auth_config: Arc::new(RwLock::new(auth_config)),
        jwks_cache: Arc::new(RwLock::new(None)),
        manager_ip,
    });

    let serve_dir = ServeDir::new("frontend/out")
        .not_found_service(ServeFile::new("frontend/out/index.html"));

    // Protected API routes (require dashboard cookie auth)
    let protected_routes = Router::new()
        .route("/apps", get(list_apps))
        .route("/apps/{app_name}/auth", get(get_auth_config).post(set_auth_config))
        .route("/deploy/{app_name}", post(deploy_app))
        .route("/logs/{app_name}", get(get_logs))
        .route("/stop/{app_name}", post(stop_app))
        .route("/delete/{app_name}", post(delete_app))
        .route("/password/{app_name}", get(get_password))
        .route("/password/{app_name}/reset", post(reset_password))
        .route("/create/{app_name}", post(create_app))
        .layer(middleware::from_fn_with_state(state.clone(), auth_middleware));

    // Public API routes (no dashboard auth)
    let public_routes = Router::new()
        .route("/login", post(login))
        .route("/auth/check", get(auth_check))
        .route("/logout", post(logout))
        .route("/verify", get(verify_forward_auth));

    let api_routes = Router::new()
        .merge(protected_routes)
        .merge(public_routes)
        .with_state(state.clone());

    let app = Router::new()
        .nest("/api", api_routes)
        .fallback_service(serve_dir);

    let port = std::env::var("UI_PORT").unwrap_or_else(|_| "8081".to_string());
    let bind_addr = format!("0.0.0.0:{}", port);
    println!("Manager UI running on http://{}", bind_addr);
    let listener = tokio::net::TcpListener::bind(&bind_addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

// ── Dashboard login/logout/check ──

async fn login(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
    Json(body): Json<LoginRequest>,
) -> (CookieJar, Json<serde_json::Value>) {
    if body.password == state.manager_password {
        let token = generate_session_token(&state.session_secret, &state.manager_password);
        let cookie = Cookie::build(("mcphub_session", token))
            .path("/")
            .http_only(true);
        (
            jar.add(cookie),
            Json(serde_json::json!({"status": "ok"})),
        )
    } else {
        (
            jar,
            Json(serde_json::json!({"error": "Invalid password"})),
        )
    }
}

async fn auth_check(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
) -> (StatusCode, Json<serde_json::Value>) {
    let expected = generate_session_token(&state.session_secret, &state.manager_password);
    match jar.get("mcphub_session") {
        Some(cookie) if cookie.value() == expected => {
            (StatusCode::OK, Json(serde_json::json!({"authenticated": true})))
        }
        _ => {
            (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"authenticated": false})))
        }
    }
}

async fn logout(jar: CookieJar) -> (CookieJar, Json<serde_json::Value>) {
    let mut cookie = Cookie::from("mcphub_session");
    cookie.set_path("/");
    (
        jar.remove(cookie),
        Json(serde_json::json!({"status": "ok"})),
    )
}

// ── Auth config CRUD ──

async fn get_auth_config(
    State(state): State<Arc<AppState>>,
    Path(app_name): Path<String>,
) -> Json<serde_json::Value> {
    let config = state.auth_config.read().unwrap();
    match config.get(&app_name) {
        Some(auth) => Json(serde_json::json!({ "auth": auth })),
        None => Json(serde_json::json!({ "auth": { "auth_type": "none" } })),
    }
}

async fn set_auth_config(
    State(state): State<Arc<AppState>>,
    Path(app_name): Path<String>,
    Json(new_auth): Json<AuthAppConfig>,
) -> Json<serde_json::Value> {
    let mut config = state.auth_config.write().unwrap();
    config.insert(app_name, new_auth);
    match save_auth_config(&config) {
        Ok(_) => Json(serde_json::json!({"status": "ok"})),
        Err(e) => Json(serde_json::json!({"error": format!("Failed to save: {}", e)})),
    }
}

// ── ForwardAuth verify endpoint (called by Traefik) ──

async fn verify_forward_auth(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Response {
    // Extract app name from X-Forwarded-Uri (e.g. "/myapp/endpoint" → "myapp")
    let forwarded_uri = headers
        .get("x-forwarded-uri")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let app_name = forwarded_uri
        .trim_start_matches('/')
        .split('/')
        .next()
        .unwrap_or("");

    if app_name.is_empty() {
        return StatusCode::OK.into_response();
    }

    // Look up auth config for this app
    let auth = {
        let config = state.auth_config.read().unwrap();
        config.get(app_name).cloned().unwrap_or(AuthAppConfig::None)
    };

    match auth {
        AuthAppConfig::None => {
            let mut resp = StatusCode::OK.into_response();
            resp.headers_mut().insert("X-Forwarded-User", "anonymous".parse().unwrap());
            resp
        }
        AuthAppConfig::ApiKey { api_key } => {
            let provided = headers
                .get("x-api-key")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("");
            if provided == api_key {
                let mut resp = StatusCode::OK.into_response();
                resp.headers_mut().insert("X-Forwarded-User", "api-key-user".parse().unwrap());
                resp
            } else {
                StatusCode::UNAUTHORIZED.into_response()
            }
        }
        AuthAppConfig::EntraId { tenant_id, client_id } => {
            match validate_entra_token(&state, &headers, &tenant_id, &client_id).await {
                Ok(user) => {
                    let mut resp = StatusCode::OK.into_response();
                    resp.headers_mut().insert(
                        "X-Forwarded-User",
                        user.parse().unwrap_or_else(|_| "unknown".parse().unwrap()),
                    );
                    resp
                }
                Err(status) => status.into_response(),
            }
        }
    }
}

// ── Entra ID JWT validation ──

const JWKS_CACHE_SECS: u64 = 3600;

async fn validate_entra_token(
    state: &Arc<AppState>,
    headers: &HeaderMap,
    tenant_id: &str,
    client_id: &str,
) -> Result<String, StatusCode> {
    // Extract Bearer token
    let auth_header = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let token = auth_header
        .strip_prefix("Bearer ")
        .ok_or(StatusCode::UNAUTHORIZED)?;

    // Get JWKS keys (cached)
    let jwks = get_jwks(state, tenant_id).await?;

    // Decode JWT header to find kid
    let jwt_header = jsonwebtoken::decode_header(token)
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

    let kid = jwt_header.kid.ok_or(StatusCode::UNAUTHORIZED)?;

    let jwk = jwks.keys.iter()
        .find(|k| k.common.key_id.as_deref() == Some(&kid))
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let decoding_key = jsonwebtoken::DecodingKey::from_jwk(jwk)
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

    let mut validation = jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::RS256);
    validation.set_audience(&[client_id]);
    validation.set_issuer(&[
        format!("https://login.microsoftonline.com/{}/v2.0", tenant_id),
        format!("https://sts.windows.net/{}/", tenant_id),
    ]);

    let token_data = jsonwebtoken::decode::<serde_json::Value>(token, &decoding_key, &validation)
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

    // Extract user identity
    let user = token_data.claims
        .get("preferred_username")
        .or_else(|| token_data.claims.get("upn"))
        .or_else(|| token_data.claims.get("sub"))
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();

    Ok(user)
}

async fn get_jwks(
    state: &Arc<AppState>,
    tenant_id: &str,
) -> Result<jsonwebtoken::jwk::JwkSet, StatusCode> {
    // Check cache
    {
        let cache = state.jwks_cache.read().unwrap();
        if let Some(ref cached) = *cache {
            if cached.tenant_id == tenant_id
                && cached.fetched_at.elapsed().as_secs() < JWKS_CACHE_SECS
            {
                return Ok(cached.keys.clone());
            }
        }
    }
    // Fetch fresh
    let url = format!(
        "https://login.microsoftonline.com/{}/discovery/v2.0/keys",
        tenant_id
    );
    let resp = reqwest::get(&url)
        .await
        .map_err(|e| {
            eprintln!("JWKS fetch failed for tenant {}: {}", tenant_id, e);
            StatusCode::UNAUTHORIZED
        })?;
    if !resp.status().is_success() {
        eprintln!("JWKS endpoint returned {} for tenant {}", resp.status(), tenant_id);
        return Err(StatusCode::UNAUTHORIZED);
    }
    let jwks: jsonwebtoken::jwk::JwkSet = resp
        .json()
        .await
        .map_err(|e| {
            eprintln!("JWKS parse failed for tenant {}: {}", tenant_id, e);
            StatusCode::UNAUTHORIZED
        })?;

    // Update cache
    {
        let mut cache = state.jwks_cache.write().unwrap();
        *cache = Some(JwksCache {
            keys: jwks.clone(),
            fetched_at: std::time::Instant::now(),
            tenant_id: tenant_id.to_string(),
        });
    }
    Ok(jwks)
}

// ── App management endpoints ──

async fn list_apps(State(state): State<Arc<AppState>>) -> Json<Vec<AppStatus>> {
    let mut apps = Vec::new();

    let paths = match fs::read_dir("/apps") {
        Ok(p) => p,
        Err(_) => return Json(apps),
    };

    let docker_ps = Command::new("docker")
        .args(["ps", "--format", "{{.Names}}|{{.Status}}"])
        .output()
        .unwrap_or_else(|_| std::process::Output {
            status: std::os::unix::process::ExitStatusExt::from_raw(0),
            stdout: Vec::new(),
            stderr: Vec::new(),
        });

    let ps_output = String::from_utf8_lossy(&docker_ps.stdout);
    let mut running_containers = std::collections::HashMap::new();

    for line in ps_output.lines() {
        let parts: Vec<&str> = line.split('|').collect();
        if parts.len() == 2 {
            running_containers.insert(parts[0].to_string(), parts[1].to_string());
        }
    }

    let auth_config = state.auth_config.read().unwrap();

    for path in paths {
        if let Ok(entry) = path {
            if let Ok(file_type) = entry.file_type() {
                if file_type.is_dir() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name == "auth_config.json" {
                        continue;
                    }
                    let status = running_containers
                        .get(&name)
                        .cloned()
                        .unwrap_or_else(|| "Not Started".to_string());
                    let auth_type = auth_config.get(&name)
                        .map(|a| match a {
                            AuthAppConfig::None => "none",
                            AuthAppConfig::ApiKey { .. } => "api_key",
                            AuthAppConfig::EntraId { .. } => "entra_id",
                        })
                        .unwrap_or("none")
                        .to_string();

                    apps.push(AppStatus { name, status, auth_type });
                }
            }
        }
    }

    Json(apps)
}

async fn deploy_app(
    State(state): State<Arc<AppState>>,
    Path(app_name): Path<String>,
) -> Json<serde_json::Value> {
    let app_dir = format!("/apps/{}", app_name);

    if !std::path::Path::new(&app_dir).exists() {
        return Json(serde_json::json!({"error": "App directory not found"}));
    }

    // Stop and remove existing container if any
    let _ = Command::new("docker")
        .args(["rm", "-f", &app_name])
        .output();

    // Build image
    let build_status = Command::new("docker")
        .args(["build", "-t", &app_name, &app_dir])
        .status()
        .expect("Failed to execute docker build");

    if !build_status.success() {
        return Json(serde_json::json!({"error": "Docker build failed"}));
    }

    // Build docker run args with Traefik labels
    let mut args: Vec<String> = vec![
        "run".into(), "-d".into(),
        "--name".into(), app_name.clone(),
        "--network".into(), "mcp-net".into(),
        "-v".into(), format!("/apps/{}:/app", app_name),
        "-e".into(), format!("APP_NAME={}", app_name),
    ];

    // Traefik enable
    args.push("--label=traefik.enable=true".into());

    // API router
    args.push(format!("--label=traefik.http.routers.{}.rule=PathPrefix(`/{}`)", app_name, app_name));
    args.push(format!("--label=traefik.http.routers.{}.service={}", app_name, app_name));
    args.push(format!("--label=traefik.http.middlewares.{}-strip.stripprefix.prefixes=/{}/, /{}", app_name, app_name, app_name));
    args.push(format!("--label=traefik.http.services.{}.loadbalancer.server.port=80", app_name));

    // ForwardAuth middleware (always attached — verify endpoint handles "none" as passthrough)
    args.push(format!(
        "--label=traefik.http.middlewares.{}-auth.forwardauth.address=http://{}:8081/api/verify",
        app_name, state.manager_ip
    ));
    args.push(format!(
        "--label=traefik.http.middlewares.{}-auth.forwardauth.authRequestHeaders=X-API-Key,Authorization",
        app_name
    ));
    args.push(format!(
        "--label=traefik.http.middlewares.{}-auth.forwardauth.authResponseHeaders=X-Forwarded-User",
        app_name
    ));
    // Chain: strip prefix then auth
    args.push(format!(
        "--label=traefik.http.routers.{}.middlewares={}-auth,{}-strip",
        app_name, app_name, app_name
    ));

    // IDE router (no ForwardAuth — IDE has its own password)
    args.push(format!("--label=traefik.http.routers.{}-ide.rule=PathPrefix(`/{}-ide`)", app_name, app_name));
    args.push(format!("--label=traefik.http.routers.{}-ide.service={}-ide", app_name, app_name));
    args.push(format!("--label=traefik.http.middlewares.{}-ide-strip.stripprefix.prefixes=/{}-ide", app_name, app_name));
    args.push(format!("--label=traefik.http.routers.{}-ide.middlewares={}-ide-strip", app_name, app_name));
    args.push(format!("--label=traefik.http.services.{}-ide.loadbalancer.server.port=8000", app_name));

    // Image name
    args.push(app_name.clone());

    let run_status = Command::new("docker")
        .args(&args)
        .status()
        .expect("Failed to execute docker run");

    if run_status.success() {
        Json(serde_json::json!({"status": "success"}))
    } else {
        Json(serde_json::json!({"error": "Docker run failed"}))
    }
}

async fn stop_app(Path(app_name): Path<String>) -> Json<serde_json::Value> {
    let status = Command::new("docker")
        .args(["rm", "-f", &app_name])
        .status();

    match status {
        Ok(s) if s.success() => Json(serde_json::json!({"status": "success"})),
        _ => Json(serde_json::json!({"error": "Failed to stop container"}))
    }
}

async fn delete_app(
    State(state): State<Arc<AppState>>,
    Path(app_name): Path<String>,
) -> Json<serde_json::Value> {
    // Stop and remove container
    let _ = Command::new("docker")
        .args(["rm", "-f", &app_name])
        .status();

    // Remove app directory
    let app_dir = format!("/apps/{}", app_name);
    if std::path::Path::new(&app_dir).exists() {
        if let Err(e) = fs::remove_dir_all(&app_dir) {
            return Json(serde_json::json!({"error": format!("Failed to remove directory: {}", e)}));
        }
    }

    // Remove auth config entry
    {
        let mut config = state.auth_config.write().unwrap();
        config.remove(&app_name);
        let _ = save_auth_config(&config);
    }

    Json(serde_json::json!({"status": "success"}))
}

async fn get_logs(Path(app_name): Path<String>) -> String {
    let output = Command::new("docker")
        .args(["logs", "--tail", "100", &app_name])
        .output()
        .expect("Failed to execute docker logs");

    String::from_utf8_lossy(&output.stdout).to_string() + &String::from_utf8_lossy(&output.stderr)
}

async fn get_password(Path(app_name): Path<String>) -> Json<serde_json::Value> {
    let output = Command::new("docker")
        .args(["exec", &app_name, "cat", "/root/.config/code-server/config.yaml"])
        .output();

    match output {
        Ok(o) if o.status.success() => {
            let config = String::from_utf8_lossy(&o.stdout);
            let password = config
                .lines()
                .find(|l| l.starts_with("password:"))
                .map(|l| l.trim_start_matches("password:").trim().to_string())
                .unwrap_or_else(|| "unknown".to_string());
            Json(serde_json::json!({"password": password}))
        }
        _ => Json(serde_json::json!({"error": "Container not running or config not found"}))
    }
}

async fn create_app(Path(app_name): Path<String>) -> Json<serde_json::Value> {
    let app_dir = format!("/apps/{}", app_name);

    if std::path::Path::new(&app_dir).exists() {
        return Json(serde_json::json!({"error": "App already exists"}));
    }

    if let Err(e) = fs::create_dir_all(&app_dir) {
        return Json(serde_json::json!({"error": format!("Failed to create directory: {}", e)}));
    }

    let dockerfile = r#"FROM python:3.11-slim
ENV PASSWORD=mcp-ide-pass
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://code-server.dev/install.sh | sh
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
CMD code-server --bind-addr 0.0.0.0:8000 /app & uvicorn app:app --host 0.0.0.0 --port 80 --reload
"#;

    let requirements = "fastapi\nuvicorn\npython-multipart\n";

    let app_py = r#"from fastapi import FastAPI, File, UploadFile
import shutil
import os

app = FastAPI()
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

@app.get("/")
def read_root():
    return {"message": "Hello from the new MCP App!"}

@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    file_path = os.path.join(UPLOAD_DIR, file.filename)
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    return {"status": "success", "filename": file.filename}
"#;

    let files = [
        ("Dockerfile", dockerfile),
        ("requirements.txt", requirements),
        ("app.py", app_py),
    ];

    for (name, content) in &files {
        let path = format!("{}/{}", app_dir, name);
        if let Err(e) = fs::write(&path, content) {
            return Json(serde_json::json!({"error": format!("Failed to write {}: {}", name, e)}));
        }
    }

    Json(serde_json::json!({"status": "success"}))
}

async fn reset_password(Path(app_name): Path<String>) -> Json<serde_json::Value> {
    let new_password = format!("{:016x}", rand::random::<u64>());

    let sed_cmd = format!("s/^password: .*/password: {}/", new_password);
    let write_result = Command::new("docker")
        .args(["exec", &app_name, "sed", "-i", &sed_cmd, "/root/.config/code-server/config.yaml"])
        .status();

    if let Ok(s) = write_result {
        if s.success() {
            let _ = Command::new("docker")
                .args(["exec", &app_name, "pkill", "-f", "code-server"])
                .status();
            let _ = Command::new("docker")
                .args(["exec", "-d", &app_name, "sh", "-c",
                    &format!("code-server --auth password --bind-addr 0.0.0.0:8000 --abs-proxy-base-path /{}-ide /app", app_name)])
                .status();

            return Json(serde_json::json!({"password": new_password}));
        }
    }
    Json(serde_json::json!({"error": "Failed to reset password"}))
}
