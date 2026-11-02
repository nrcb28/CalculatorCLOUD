//! PDF vectorial generado en Rust, con tipografía incluida y cálculos decimales.
use crate::project;
use bigdecimal::{BigDecimal, ToPrimitive};
use printpdf::{
    path::{PaintMode, WindingOrder},
    *,
};
use serde::Serialize;
use serde_json::Value;
fn display(v: &Value) -> String {
    v.as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| v.to_string())
}
const FONT: &[u8] = include_bytes!("../assets/OpenSans-Regular.ttf");
#[derive(Serialize)]
pub struct ReportPdf {
    pub bytes: Vec<u8>,
    pub pages: usize,
    pub monthly: String,
    pub total: String,
}
struct Writer {
    doc: PdfDocumentReference,
    font: IndirectFontRef,
    face: ttf_parser::Face<'static>,
    layer: PdfLayerReference,
    y: f32,
    pages: usize,
    substituted: bool,
}
impl Writer {
    fn new() -> Result<Self, String> {
        let (doc, page, layer) = PdfDocument::new(
            "CloudCost Compare - Proyecto",
            Mm(210.),
            Mm(297.),
            "Informe",
        );
        let font = doc
            .add_external_font(&mut std::io::Cursor::new(FONT))
            .map_err(|_| "No se pudo incluir la tipografía")?;
        let face = ttf_parser::Face::parse(FONT, 0).map_err(|_| "Tipografía no válida")?;
        let layer = doc.get_page(page).get_layer(layer);
        let mut w = Self {
            doc,
            font,
            face,
            layer,
            y: 277.,
            pages: 1,
            substituted: false,
        };
        w.frame();
        Ok(w)
    }
    fn frame(&mut self) {
        self.layer
            .set_fill_color(Color::Rgb(Rgb::new(0.15, 0.18, 0.28, None)));
        self.layer.use_text(
            "CloudCost Compare · proyecto y fuentes",
            10.,
            Mm(16.),
            Mm(284.),
            &self.font,
        );
        self.layer.use_text(
            format!("{} · USD · subtotal de cargos cotizados", self.pages),
            8.,
            Mm(16.),
            Mm(11.),
            &self.font,
        );
    }
    fn page(&mut self) -> Result<(), String> {
        if self.pages >= 200 {
            return Err("Informe demasiado largo".into());
        }
        let (p, l) = self.doc.add_page(Mm(210.), Mm(297.), "Informe");
        self.layer = self.doc.get_page(p).get_layer(l);
        self.pages += 1;
        self.y = 277.;
        self.frame();
        Ok(())
    }
    fn space(&mut self, height: f32) -> Result<(), String> {
        if self.y - height < 20. {
            self.page()?;
        }
        Ok(())
    }
    fn width(&self, s: &str, size: f32) -> f32 {
        s.chars()
            .map(|c| {
                self.face
                    .glyph_index(c)
                    .and_then(|g| self.face.glyph_hor_advance(g))
                    .unwrap_or(0) as f32
            })
            .sum::<f32>()
            / self.face.units_per_em() as f32
            * size
            * 25.4
            / 72.
    }
    fn text(&mut self, s: &str, size: f32) -> Result<(), String> {
        let clean: String = s
            .chars()
            .map(|c| {
                if c.is_control() {
                    ' '
                } else if self.face.glyph_index(c).is_some() {
                    c
                } else {
                    self.substituted = true;
                    '?'
                }
            })
            .collect();
        let mut line = String::new();
        for word in clean.split_whitespace() {
            let combined = if line.is_empty() {
                word.to_string()
            } else {
                format!("{line} {word}")
            };
            if self.width(&combined, size) <= 178. {
                line = combined;
                continue;
            }
            if !line.is_empty() {
                self.line(&line, size)?;
                line.clear();
            }
            for c in word.chars() {
                let next = format!("{line}{c}");
                if self.width(&next, size) > 178. && !line.is_empty() {
                    self.line(&line, size)?;
                    line.clear();
                }
                line.push(c);
            }
        }
        if !line.is_empty() {
            self.line(&line, size)?;
        }
        self.y -= 1.5;
        Ok(())
    }
    fn line(&mut self, s: &str, size: f32) -> Result<(), String> {
        self.space(size * 0.45 + 2.)?;
        self.layer
            .use_text(s, size, Mm(16.), Mm(self.y), &self.font);
        self.y -= size * 0.45 + 0.5;
        Ok(())
    }
    fn rect(&mut self, x: f32, y: f32, w: f32, h: f32) {
        self.layer
            .set_fill_color(Color::Rgb(Rgb::new(0.34, 0.31, 0.73, None)));
        self.layer.add_polygon(Polygon {
            rings: vec![vec![
                (Point::new(Mm(x), Mm(y)), false),
                (Point::new(Mm(x + w), Mm(y)), false),
                (Point::new(Mm(x + w), Mm(y + h)), false),
                (Point::new(Mm(x), Mm(y + h)), false),
            ]],
            mode: PaintMode::Fill,
            winding_order: WindingOrder::NonZero,
        });
        self.layer
            .set_fill_color(Color::Rgb(Rgb::new(0.15, 0.18, 0.28, None)));
    }
    fn monthly_chart(&mut self, months: &[BigDecimal]) -> Result<(), String> {
        self.space(70.)?;
        self.text("Coste por mes de referencia (escala desde cero)", 11.)?;
        let max = months.iter().cloned().max().unwrap_or_default();
        self.text(
            &format!(
                "Máximo: {} USD; valores exactos redondeados en la tabla siguiente",
                project::money(&max)
            ),
            8.,
        )?;
        let scale = max.to_f64().unwrap_or(0.);
        let y = self.y - 45.;
        for (i, amount) in months.iter().enumerate() {
            let h = if scale > 0. {
                (amount.to_f64().unwrap_or(0.) / scale * 38.) as f32
            } else {
                0.
            };
            let x = 20. + i as f32 * 14.;
            self.rect(x, y, 9., h);
            self.layer
                .use_text((i + 1).to_string(), 7., Mm(x), Mm(y - 4.), &self.font);
        }
        self.y = y - 10.;
        Ok(())
    }
}
pub fn render(data: &str) -> Result<ReportPdf, String> {
    let p = project::normalize(data)?;
    let (monthly, months) = project::totals(&p)?;
    let total: BigDecimal = months.iter().cloned().sum();
    let mut w = Writer::new()?;
    w.text(p["name"].as_str().ok_or("Falta nombre")?, 18.)?;
    w.text(
        &format!(
            "Proyecto {} · creado {} · exportado {}",
            display(&p["id"]),
            display(&p["created"]),
            chrono::Utc::now().to_rfc3339()
        ),
        8.,
    )?;
    w.text(
        &format!(
            "Mes base: {} USD · Doce meses: {} USD",
            project::money(&monthly),
            project::money(&total)
        ),
        13.,
    )?;
    w.text("Se suma únicamente el proveedor elegido de cada recurso. Los planes se aplican por recurso; sin plan se repite el mes base doce veces. La suma usa decimales exactos antes de redondear.",9.)?;
    w.text("Cobertura parcial: no acredita equivalencia, ahorro ni factura futura. Sin impuestos, soporte, descuentos ni servicios excluidos. AWS/GCP solo computación; Azure añade disco y salida únicamente si están cotizados. La salida Azure se consolida en un solo recurso para no repetir tramos.",9.)?;
    w.monthly_chart(&months)?;
    for (i, m) in months.iter().enumerate() {
        w.text(&format!("Mes {:02}: {} USD", i + 1, project::money(m)), 8.)?;
    }
    w.text("Distribución por recurso · coste de doce meses", 12.)?;
    let mut costs = Vec::new();
    for r in p["resources"].as_array().ok_or("Faltan recursos")? {
        costs.push(project::resource_cost(r)?);
    }
    let max = costs
        .iter()
        .map(|c| c.total.clone())
        .max()
        .unwrap_or_default()
        .to_f64()
        .unwrap_or(0.);
    for (i, c) in costs.iter().enumerate() {
        w.space(15.)?;
        w.text(
            &format!("Recurso {}: {} USD", i + 1, project::money(&c.total)),
            8.,
        )?;
        let width = if max > 0. {
            (c.total.to_f64().unwrap_or(0.) / max * 165.) as f32
        } else {
            0.
        };
        w.rect(16., w.y - 3., width, 3.);
        w.y -= 8.;
    }
    for (index, r) in p["resources"].as_array().unwrap().iter().enumerate() {
        w.page()?;
        let s = &r["snapshot"];
        let c = &s["config"];
        let provider = r["provider"].as_str().unwrap();
        let cost = &costs[index];
        w.text(
            &format!("Recurso {}: {}", index + 1, r["name"].as_str().unwrap()),
            14.,
        )?;
        w.text(
            &format!(
                "ID {} · proveedor elegido {} · presupuesto {} · guardado {}",
                display(&r["id"]),
                provider,
                display(&s["id"]),
                display(&s["created"])
            ),
            8.,
        )?;
        w.text(
            &format!(
                "Mes base {} USD · doce meses {} USD",
                project::money(&cost.monthly),
                project::money(&cost.total)
            ),
            11.,
        )?;
        w.text(&format!("Consumo base: {} instancias × {} horas/mes. Disco solicitado: {} GiB/instancia; salida: {} GB; uso previo: {} GB.",c["instances"],c["hours"],c["storage"],c["egress"],c.get("egressUsedGB").unwrap_or(&Value::from(0))),9.)?;
        if provider == "Azure" {
            let rate = &s["rates"][0];
            w.text(
                &format!(
                    "Azure {} · región {} · Linux PAYG · {}",
                    display(&c["sku"]),
                    display(&c["region"]),
                    display(&rate["productName"])
                ),
                10.,
            )?;
            w.text(
                &format!(
                    "Medidor {} · {} · {} USD/h · vigencia {}",
                    display(&rate["meterId"]),
                    display(&rate["skuName"]),
                    rate["retailPrice"],
                    display(&rate["effectiveStartDate"])
                ),
                8.,
            )?;
            w.text(
                &format!(
                    "Fuente https://prices.azure.com/api/retail/prices · consulta {}",
                    display(&s["fetched"])
                ),
                8.,
            )?;
            if let Some(q) = s.get("components") {
                w.text(
                    &format!(
                        "Discos Premium SSD LRS y salida MGN: {} · consulta {}",
                        display(&q["source"]),
                        display(&q["fetched"])
                    ),
                    8.,
                )?;
                if !q["disk"].is_null() {
                    w.text(
                        &format!(
                            "Disco {} · medidor {} · {} USD/mes/instancia · vigencia {}",
                            display(&q["disk"]["meterName"]),
                            display(&q["disk"]["meterId"]),
                            q["disk"]["retailPrice"],
                            display(&q["disk"]["effectiveStartDate"])
                        ),
                        8.,
                    )?;
                }
                for tier in q["network"].as_array().ok_or("Faltan tramos")? {
                    w.text(
                        &format!(
                            "Red: tramo desde {} GB · {} USD/GB · medidor {} · vigencia {}",
                            tier["tierMinimumUnits"],
                            tier["retailPrice"],
                            display(&tier["meterId"]),
                            display(&tier["effectiveStartDate"])
                        ),
                        8.,
                    )?;
                }
                w.text("Capacidad de disco por mes completo incluso a cero horas; sin bursting/snapshots. Salida incremental sobre uso previo; umbrales literales de la API distintos de la tabla comercial. Verificar condiciones Azure. No se acumula uso previo entre meses.",8.)?;
            } else {
                w.text(
                    "Solo computación: disco y red no cotizados en este recurso.",
                    9.,
                )?;
            }
        } else {
            let q = s["comparisonQuotes"]
                .as_array()
                .unwrap()
                .iter()
                .find(|q| q["provider"] == provider)
                .ok_or("Falta tarifa")?;
            w.text(
                &format!(
                    "{} · región {} · {} vCPU / {} GiB · Linux OnDemand · solo computación",
                    display(&q["instanceType"]),
                    display(&q["region"]),
                    q["vcpu"],
                    q["memoryGiB"]
                ),
                10.,
            )?;
            w.text(
                &format!(
                    "Fuente {} · consulta {}",
                    display(&q["source"]),
                    display(&q["fetched"])
                ),
                8.,
            )?;
            if provider == "AWS" {
                w.text(&format!("Versión {} · publicación {} · Linux compartido, sin software adicional, reservas ni Spot",display(&q["catalogVersion"]),display(&q["published"])),8.)?;
            } else {
                w.text(
                    "N2 CPU y RAM bajo demanda; sin compromisos ni descuentos sostenidos.",
                    8.,
                )?;
            }
            for charge in q["charges"].as_array().unwrap() {
                w.text(
                    &format!(
                        "Cargo {} · {} · {} × {} USD/{} · vigencia {}",
                        display(&charge["id"]),
                        display(&charge["description"]),
                        charge["quantity"],
                        display(&charge["unitPriceUSD"]),
                        display(&charge["unit"]),
                        display(&charge["effective"])
                    ),
                    8.,
                )?;
            }
        }
        if let Some(plan) = s.get("usagePlan") {
            w.text(
                "Plan mensual con precios conservados (no calendario civil):",
                10.,
            )?;
            for (i, m) in plan["months"].as_array().unwrap().iter().enumerate() {
                w.text(
                    &format!(
                        "Mes {:02}: {} instancias × {} horas; {} USD",
                        i + 1,
                        m["instances"],
                        m["hours"],
                        project::money(&cost.months[i])
                    ),
                    8.,
                )?;
            }
            w.text("Disco por instancia, salida total y uso previo conservan los valores del mes base. Horas entre 0 y 744; cada mes es de referencia.",8.)?;
        } else {
            w.text(
                "Sin plan: doce meses con idéntico consumo base y precios conservados.",
                9.,
            )?;
        }
    }
    w.text("Una importación JSON valida estructura y condiciones; no acredita autenticidad contra el proveedor. Conserve el JSON/CSV para revisar los datos y valores exactos. Los gráficos usan escala proporcional; los importes se calculan con aritmética decimal.",8.)?;
    if w.substituted {
        w.text("Algunos caracteres sin glifo se han sustituido por ? en el PDF. El JSON conserva el texto original.",8.)?;
    }
    w.text("Tipografía Open Sans: © 2010–2011 Google Corporation. Licencia Apache 2.0, incluida en la distribución. Informe generado localmente, sin impresión del sistema ni solicitudes de red.",7.)?;
    let pages = w.pages;
    let bytes = w
        .doc
        .save_to_bytes()
        .map_err(|_| "No se pudo generar PDF")?;
    Ok(ReportPdf {
        bytes,
        pages,
        monthly: project::money(&monthly),
        total: project::money(&total),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn creates_a_readable_pdf_with_embedded_unicode_font_charts_and_matching_totals() {
        let sample = include_str!("../../tests/project-fixture.json");
        let result = render(sample).unwrap();
        assert!(result.bytes.starts_with(b"%PDF-"));
        assert_eq!(result.monthly, "578.44");
        assert_eq!(result.total, "6482.84");
        let doc = printpdf::lopdf::Document::load_mem(&result.bytes).unwrap();
        assert_eq!(doc.get_pages().len(), result.pages);
        assert!(result.pages >= 3);
        let mut found_font = false;
        let mut rectangles = 0;
        for object in doc.objects.values() {
            if let Ok(dict) = object.as_dict() {
                if dict.has(b"FontFile2") {
                    found_font = true;
                }
            }
        }
        for (_, id) in doc.get_pages() {
            let content = doc.get_page_content(id).unwrap();
            let decoded = printpdf::lopdf::content::Content::decode(&content).unwrap();
            rectangles += decoded
                .operations
                .iter()
                .filter(|o| o.operator == "f" || o.operator == "f*")
                .count();
        }
        assert!(found_font);
        assert!(rectangles >= 14);
        assert!(render("{}").is_err());
    }
}
