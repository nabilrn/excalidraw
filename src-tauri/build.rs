use std::{env, fs, path::{Path, PathBuf}};

fn dotenv_value(path: &Path, key: &str) -> Option<String> {
    let contents = fs::read_to_string(path).ok()?;

    contents.lines().find_map(|line| {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            return None;
        }

        let (name, value) = line.split_once('=')?;
        if name.trim() != key {
            return None;
        }

        let value = value
            .trim()
            .trim_matches(|character| character == '"' || character == '\'')
            .trim();

        (!value.is_empty()).then(|| value.to_string())
    })
}

fn project_root() -> Option<PathBuf> {
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").ok()?;
    Path::new(&manifest_dir).parent().map(Path::to_path_buf)
}

fn main() {
    println!("cargo:rerun-if-env-changed=GOOGLE_CLIENT_SECRET");
    println!("cargo:rerun-if-env-changed=FOCUSCANVAS_GOOGLE_CLIENT_SECRET");
    println!("cargo:rerun-if-changed=../.env.local");
    println!("cargo:rerun-if-changed=../.env");

    let secret = env::var("FOCUSCANVAS_GOOGLE_CLIENT_SECRET")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            env::var("GOOGLE_CLIENT_SECRET")
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
        .or_else(|| {
            let root = project_root()?;
            dotenv_value(&root.join(".env.local"), "GOOGLE_CLIENT_SECRET")
                .or_else(|| dotenv_value(&root.join(".env"), "GOOGLE_CLIENT_SECRET"))
        });

    if let Some(secret) = secret {
        println!("cargo:rustc-env=FOCUSCANVAS_GOOGLE_CLIENT_SECRET={secret}");
        println!("cargo:warning=FocusCanvas Google OAuth client secret loaded for native build");
    } else {
        println!("cargo:warning=FocusCanvas Google OAuth client secret was not found in the process environment, .env.local, or .env");
    }

    tauri_build::build()
}
