use cloudcost_core::multicloud::fetch_aws;
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let instance = args.next().unwrap_or_else(|| "m6i.xlarge".into());
    let region = args.next().unwrap_or_else(|| "eu-west-1".into());
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let quote = runtime.block_on(fetch_aws(&instance, &region))?;
    println!("{}", serde_json::to_string_pretty(&quote)?);
    Ok(())
}
