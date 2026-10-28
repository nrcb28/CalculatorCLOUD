// Datos sintéticos exclusivos de pruebas. Nunca se cargan desde producción.
export const fixture = {
  id: "test-snapshot",
  name: "Escenario de prueba",
  created: "2025-01-01T00:00:00Z",
  fetched: "2025-01-01T00:00:00Z",
  config: {
    sku: "Standard_D4s_v5",
    region: "westeurope",
    instances: 2,
    hours: 730,
    storage: 100,
    egress: 0,
  },
  rates: [
    {
      meterId: "test-meter",
      skuName: "D4s v5",
      armSkuName: "Standard_D4s_v5",
      productName: "Virtual Machines Dsv5 Series",
      armRegionName: "westeurope",
      unitOfMeasure: "1 Hour",
      retailPrice: 0.1,
      currencyCode: "USD",
      effectiveStartDate: "2025-01-01T00:00:00Z",
      type: "Consumption",
      isPrimaryMeterRegion: true,
    },
  ],
};
