//! Crear un PDF real y verificar persistencia del proyecto en una base nueva.
use cloudcost_core::{project, report_pdf, storage};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() != 3 {
        return Err("Indica proyecto JSON, base SQLite nueva y PDF nuevo".into());
    }
    if std::path::Path::new(&args[1]).exists() || std::path::Path::new(&args[2]).exists() {
        return Err("Usa rutas nuevas".into());
    }
    let data = std::fs::read_to_string(&args[0])?;
    let p = project::normalize(&data)?;
    let db = std::path::Path::new(&args[1]);
    storage::save_project(db, &data)?;
    let entries = storage::list_projects(db)?;
    if entries != vec![p.to_string()] {
        return Err("La copia guardada no coincide tras reabrir".into());
    }
    let report = report_pdf::render(&entries[0])?;
    std::fs::write(&args[2], &report.bytes)?;
    println!(
        "{}",
        serde_json::json!({"ok":true,"resources":p["resources"].as_array().unwrap().len(),"pages":report.pages,"monthly":report.monthly,"twelveMonths":report.total,"pdfBytes":report.bytes.len(),"verifiedAt":chrono::Utc::now().to_rfc3339()})
    );
    Ok(())
}
