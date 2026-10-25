/**
 * Account state. Everything the broker remembers lives in this one plain JSON
 * object, so it can be stored in a file, a cookie, localStorage or a database
 * row and handed back on the next request.
 *
 * Timestamps are milliseconds since the epoch.
 */

import { z } from "zod";

export const STARTING_CASH = 1_000_000;
/** Older closed orders are trimmed so the state stays small. Open orders are always kept. */
export const MAX_ORDERS_KEPT = 100;

export const SideSchema = z.enum(["BUY", "SELL"]);
export const OrderTypeSchema = z.enum(["MARKET", "LIMIT"]);
export const OrderStatusSchema = z.enum(["OPEN", "FILLED", "CANCELLED", "REJECTED"]);

export type Side = z.infer<typeof SideSchema>;
export type OrderType = z.infer<typeof OrderTypeSchema>;
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

const money = z.number().finite();
const timestamp = z.number().int().nonnegative();

export const PositionSchema = z.object({
  qty: z.number().int().positive(),
  avgPrice: money.positive(),
});
export type Position = z.infer<typeof PositionSchema>;

export const OrderSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  side: SideSchema,
  qty: z.number().int().positive(),
  type: OrderTypeSchema,
  limitPrice: money.positive().optional(),
  status: OrderStatusSchema,
  reason: z.string().optional(),
  createdAt: timestamp,
  filledAt: timestamp.optional(),
  fillPrice: money.positive().optional(),
  cancelledAt: timestamp.optional(),
});
export type Order = z.infer<typeof OrderSchema>;

export const PreviewSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  side: SideSchema,
  qty: z.number().int().positive(),
  type: OrderTypeSchema,
  limitPrice: money.positive().optional(),
  /** LTP at preview time (MARKET) or the limit price (LIMIT). */
  estimatedPrice: money.positive(),
  estimatedValue: money.positive(),
  createdAt: timestamp,
  expiresAt: timestamp,
});
export type Preview = z.infer<typeof PreviewSchema>;

export const BrokerStateSchema = z.object({
  version: z.literal(1),
  cash: money,
  realizedPnl: money,
  positions: z.record(z.string(), PositionSchema),
  orders: z.array(OrderSchema),
  previews: z.record(z.string(), PreviewSchema),
  nextOrderNo: z.number().int().positive(),
  nextPreviewNo: z.number().int().positive(),
});
export type BrokerState = z.infer<typeof BrokerStateSchema>;

export function initialState(cash: number = STARTING_CASH): BrokerState {
  return {
    version: 1,
    cash,
    realizedPnl: 0,
    positions: {},
    orders: [],
    previews: {},
    nextOrderNo: 1,
    nextPreviewNo: 1,
  };
}

/** Validate untrusted input (for example a state blob sent back by a browser). Throws on bad data. */
export function parseState(input: unknown): BrokerState {
  return BrokerStateSchema.parse(input);
}
