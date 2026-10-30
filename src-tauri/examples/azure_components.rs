use cloudcost_core::provider::fetch_components;
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let region = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "westeurope".into());
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let result = runtime.block_on(fetch_components(&region))?;
    println!("{}", serde_json::to_string_pretty(&result)?);
    Ok(())
}
