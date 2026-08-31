use std::{env, fs, path::Path};

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

fn main() {
    println!("cargo:rerun-if-env-changed=GOOGLE_CLIENT_SECRET");
    println!("cargo:rerun-if-changed=../.env.local");

    let secret = env::var("GOOGLE_CLIENT_SECRET")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            let manifest_dir = env::var("CARGO_MANIFEST_DIR").ok()?;
            dotenv_value(
                Path::new(&manifest_dir).join("../.env.local").as_path(),
                "GOOGLE_CLIENT_SECRET",
            )
        });

    if let Some(secret) = secret {
        println!("cargo:rustc-env=FOCUSCANVAS_GOOGLE_CLIENT_SECRET={secret}");
    }

    tauri_build::build()
}
