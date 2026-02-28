use axum::{
    extract::{Path, State},
    http::{Request, StatusCode},
    middleware::{self, Next},
    response::Response,
    routing::{get, post},
    Json, Router,
};
use axum_extra::extract::cookie::{Cookie, CookieJar};
use serde::{Deserialize, Serialize};
use std::process::Command;
use std::sync::Arc;
use tower_http::services::{ServeDir, ServeFile};
use std::fs;

#[derive(Serialize)]
struct AppStatus {
    name: String,
    status: String,
}

#[derive(Deserialize)]
struct LoginRequest {
    password: String,
}

#[derive(Clone)]
struct AppState {
    session_secret: String,
    manager_password: String,
}

fn generate_session_token(secret: &str, password: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    secret.hash(&mut hasher);
    password.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

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

#[tokio::main]
async fn main() {
    let manager_password = std::env::var("MANAGER_PASSWORD")
        .unwrap_or_else(|_| "mcp-hub-password".to_string());

    let session_secret = format!("{:016x}", rand::random::<u64>());

    let state = Arc::new(AppState {
        session_secret,
        manager_password,
    });

    let serve_dir = ServeDir::new("frontend/out")
        .not_found_service(ServeFile::new("frontend/out/index.html"));

    // Protected API routes (require auth)
    let protected_routes = Router::new()
        .route("/apps", get(list_apps))
        .route("/deploy/{app_name}", post(deploy_app))
        .route("/logs/{app_name}", get(get_logs))
        .route("/stop/{app_name}", post(stop_app))
        .route("/delete/{app_name}", post(delete_app))
        .route("/password/{app_name}", get(get_password))
        .route("/password/{app_name}/reset", post(reset_password))
        .route("/create/{app_name}", post(create_app))
        .layer(middleware::from_fn_with_state(state.clone(), auth_middleware));

    // Public API routes (no auth required)
    let public_routes = Router::new()
        .route("/login", post(login))
        .route("/auth/check", get(auth_check))
        .route("/logout", post(logout));

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

async fn list_apps() -> Json<Vec<AppStatus>> {
    let mut apps = Vec::new();

    // Read directories in ../apps
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

    for path in paths {
        if let Ok(entry) = path {
            if let Ok(file_type) = entry.file_type() {
                if file_type.is_dir() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    let status = running_containers
                        .get(&name)
                        .cloned()
                        .unwrap_or_else(|| "Not Started".to_string());

                    apps.push(AppStatus { name, status });
                }
            }
        }
    }

    Json(apps)
}

async fn deploy_app(Path(app_name): Path<String>) -> Json<serde_json::Value> {
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

    // Run container with Traefik labels
    let run_status = Command::new("docker")
        .args([
            "run", "-d",
            "--name", &app_name,
            "--network", "mcp-net",
            // Mount app directory for code persistence across restarts
            "-v", &format!("/apps/{}:/app", app_name),
            // Pass app name so code-server can set --base-path
            "-e", &format!("APP_NAME={}", app_name),
            // Traefik labels
            &format!("--label=traefik.enable=true"),
            // API setup
            &format!("--label=traefik.http.routers.{}.rule=PathPrefix(`/{}`)", app_name, app_name),
            &format!("--label=traefik.http.routers.{}.service={}", app_name, app_name),
            &format!("--label=traefik.http.middlewares.{}-strip.stripprefix.prefixes=/{}/, /{}", app_name, app_name, app_name),
            &format!("--label=traefik.http.routers.{}.middlewares={}-strip", app_name, app_name),
            &format!("--label=traefik.http.services.{}.loadbalancer.server.port=80", app_name),
            // IDE setup — strip prefix so code-server sees clean paths
            &format!("--label=traefik.http.routers.{}-ide.rule=PathPrefix(`/{}-ide`)", app_name, app_name),
            &format!("--label=traefik.http.routers.{}-ide.service={}-ide", app_name, app_name),
            &format!("--label=traefik.http.middlewares.{}-ide-strip.stripprefix.prefixes=/{}-ide", app_name, app_name),
            &format!("--label=traefik.http.routers.{}-ide.middlewares={}-ide-strip", app_name, app_name),
            &format!("--label=traefik.http.services.{}-ide.loadbalancer.server.port=8000", app_name),
            &app_name
        ])
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

async fn delete_app(Path(app_name): Path<String>) -> Json<serde_json::Value> {
    // Stop and remove container (ignore errors if not running)
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
            // Parse password from config.yaml: "password: xxxxx"
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
    // Generate a simple random password
    let new_password = format!("{:016x}", rand::random::<u64>());

    // Write new password to code-server config
    let sed_cmd = format!("s/^password: .*/password: {}/", new_password);
    let write_result = Command::new("docker")
        .args(["exec", &app_name, "sed", "-i", &sed_cmd, "/root/.config/code-server/config.yaml"])
        .status();

    if let Ok(s) = write_result {
        if s.success() {
            // Restart code-server process inside the container
            let _ = Command::new("docker")
                .args(["exec", &app_name, "pkill", "-f", "code-server"])
                .status();
            // code-server will be restarted by the CMD in Dockerfile since it's backgrounded with &
            // Wait a moment and start it again
            let _ = Command::new("docker")
                .args(["exec", "-d", &app_name, "sh", "-c",
                    &format!("code-server --auth password --bind-addr 0.0.0.0:8000 --abs-proxy-base-path /{}-ide /app", app_name)])
                .status();

            return Json(serde_json::json!({"password": new_password}));
        }
    }
    Json(serde_json::json!({"error": "Failed to reset password"}))
}
