export interface Position {
  side: "BUY" | "SELL";
  size: number;
  entryPrice: number;
  entryTime: Date;
  orderId: string;
}