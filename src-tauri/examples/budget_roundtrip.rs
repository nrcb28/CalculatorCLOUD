//! Persistir un snapshot JSON en una base de diagnóstico nueva y reabrirlo.
use cloudcost_core::{storage, validation};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let input = args.next().ok_or("Indica el snapshot JSON")?;
    let path = std::path::PathBuf::from(args.next().ok_or("Indica una base SQLite nueva")?);
    if path.exists() {
        return Err("La base ya existe; usa una ruta nueva".into());
    }
    let data = std::fs::read_to_string(input)?;
    let value: serde_json::Value = serde_json::from_str(&data)?;
    let id = value["id"].as_str().ok_or("Falta ID")?;
    let expected = validation::normalize_budget(id, &data)?;
    storage::save_budget(&path, id, &data)?;
    if storage::list_budgets(&path)? != vec![expected] {
        return Err("El snapshot no sobrevivió a la reapertura".into());
    }
    println!(
        "{}",
        serde_json::json!({"ok":true,"snapshotsAfterReopen":1,"components":value.get("components").is_some(),"verifiedAt":chrono::Utc::now().to_rfc3339()})
    );
    Ok(())
}
