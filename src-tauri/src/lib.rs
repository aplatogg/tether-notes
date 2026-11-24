use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const MINI_LABEL: &str = "mini";

fn toggle_mini(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window(MINI_LABEL) else {
        return;
    };

    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn create_mini_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    if app.get_webview_window(MINI_LABEL).is_some() {
        return Ok(());
    }

    WebviewWindowBuilder::new(app, MINI_LABEL, WebviewUrl::App("mini/".into()))
        .title("Tether Notes — Quick capture")
        .inner_size(430.0, 320.0)
        .min_inner_size(360.0, 260.0)
        .resizable(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .shadow(true)
        .center()
        .build()?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let is_mini_shortcut = shortcut.matches(
                        Modifiers::CONTROL | Modifiers::ALT,
                        Code::KeyN,
                    );
                    if is_mini_shortcut {
                        toggle_mini(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            // A failure here must never abort startup: another instance (or another
            // app) may already own the hotkey, which would otherwise force-close.
            if let Err(error) = create_mini_window(app.handle()) {
                eprintln!("quick capture window unavailable: {error}");
            }

            let shortcut = Shortcut::new(
                Some(Modifiers::CONTROL | Modifiers::ALT),
                Code::KeyN,
            );

            if let Err(error) = app.global_shortcut().register(shortcut) {
                eprintln!("global shortcut unavailable: {error}");
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Tether Notes");
}


