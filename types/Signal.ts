export interface Signal {
  direction: "UP" | "DOWN";
  previousPrice: number;
  currentPrice: number;
  percentChange: number;
  timestamp: Date;
}
