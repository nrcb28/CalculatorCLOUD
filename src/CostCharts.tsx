import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";
export default function CostCharts({
  monthly,
  kind = "projection",
}: {
  monthly: number;
  kind?: "projection" | "breakdown";
}) {
  const data = Array.from({ length: 12 }, (_, i) => ({
    month: `${i + 1}`,
    USD: Number((monthly * (i + 1)).toFixed(2)),
  }));
  const axes = {
    tick: { fill: "var(--muted)", fontSize: 11 },
    axisLine: false,
    tickLine: false,
  };
  return (
    <div
      className="chart"
      role="img"
      aria-label={
        kind === "projection"
          ? "Proyección acumulada de computación a 12 meses"
          : "Coste mensual de computación"
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        {kind === "projection" ? (
          <LineChart
            data={data}
            margin={{ top: 12, right: 18, bottom: 4, left: 4 }}
          >
            <CartesianGrid
              stroke="var(--line)"
              vertical={false}
              strokeDasharray="3 5"
            />
            <XAxis dataKey="month" {...axes} />
            <YAxis {...axes} width={65} />
            <Tooltip
              contentStyle={{
                background: "var(--surface)",
                border: "1px solid var(--line)",
                borderRadius: 10,
              }}
              formatter={(value) => [
                `$${Number(value).toLocaleString("es-ES", { minimumFractionDigits: 2 })}`,
                "Acumulado USD",
              ]}
              labelFormatter={(value) => `Mes ${value}`}
            />
            <Line
              type="monotone"
              dataKey="USD"
              stroke="#9b8afb"
              strokeWidth={3}
              dot={false}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        ) : (
          <BarChart
            data={[{ name: "Computación", USD: monthly }]}
            margin={{ top: 12, right: 18, bottom: 4, left: 4 }}
          >
            <CartesianGrid
              stroke="var(--line)"
              vertical={false}
              strokeDasharray="3 5"
            />
            <XAxis dataKey="name" {...axes} />
            <YAxis {...axes} width={65} />
            <Tooltip
              contentStyle={{
                background: "var(--surface)",
                border: "1px solid var(--line)",
                borderRadius: 10,
              }}
            />
            <Bar
              dataKey="USD"
              fill="#9b8afb"
              radius={[6, 6, 0, 0]}
              maxBarSize={80}
            />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
