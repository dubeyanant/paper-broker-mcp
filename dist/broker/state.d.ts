/**
 * Account state. Everything the broker remembers lives in this one plain JSON
 * object, so it can be stored in a file, a cookie, localStorage or a database
 * row and handed back on the next request.
 *
 * Timestamps are milliseconds since the epoch.
 */
import { z } from "zod";
export declare const STARTING_CASH = 1000000;
/** Older closed orders are trimmed so the state stays small. Open orders are always kept. */
export declare const MAX_ORDERS_KEPT = 100;
export declare const SideSchema: z.ZodEnum<{
    BUY: "BUY";
    SELL: "SELL";
}>;
export declare const OrderTypeSchema: z.ZodEnum<{
    LIMIT: "LIMIT";
    MARKET: "MARKET";
}>;
export declare const OrderStatusSchema: z.ZodEnum<{
    CANCELLED: "CANCELLED";
    FILLED: "FILLED";
    OPEN: "OPEN";
    REJECTED: "REJECTED";
}>;
export type Side = z.infer<typeof SideSchema>;
export type OrderType = z.infer<typeof OrderTypeSchema>;
export type OrderStatus = z.infer<typeof OrderStatusSchema>;
export declare const PositionSchema: z.ZodObject<{
    qty: z.ZodNumber;
    avgPrice: z.ZodNumber;
}, z.core.$strip>;
export type Position = z.infer<typeof PositionSchema>;
export declare const OrderSchema: z.ZodObject<{
    id: z.ZodString;
    symbol: z.ZodString;
    side: z.ZodEnum<{
        BUY: "BUY";
        SELL: "SELL";
    }>;
    qty: z.ZodNumber;
    type: z.ZodEnum<{
        LIMIT: "LIMIT";
        MARKET: "MARKET";
    }>;
    limitPrice: z.ZodOptional<z.ZodNumber>;
    status: z.ZodEnum<{
        CANCELLED: "CANCELLED";
        FILLED: "FILLED";
        OPEN: "OPEN";
        REJECTED: "REJECTED";
    }>;
    reason: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodNumber;
    filledAt: z.ZodOptional<z.ZodNumber>;
    fillPrice: z.ZodOptional<z.ZodNumber>;
    cancelledAt: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type Order = z.infer<typeof OrderSchema>;
export declare const PreviewSchema: z.ZodObject<{
    id: z.ZodString;
    symbol: z.ZodString;
    side: z.ZodEnum<{
        BUY: "BUY";
        SELL: "SELL";
    }>;
    qty: z.ZodNumber;
    type: z.ZodEnum<{
        LIMIT: "LIMIT";
        MARKET: "MARKET";
    }>;
    limitPrice: z.ZodOptional<z.ZodNumber>;
    estimatedPrice: z.ZodNumber;
    estimatedValue: z.ZodNumber;
    createdAt: z.ZodNumber;
    expiresAt: z.ZodNumber;
}, z.core.$strip>;
export type Preview = z.infer<typeof PreviewSchema>;
export declare const BrokerStateSchema: z.ZodObject<{
    version: z.ZodLiteral<1>;
    cash: z.ZodNumber;
    realizedPnl: z.ZodNumber;
    positions: z.ZodRecord<z.ZodString, z.ZodObject<{
        qty: z.ZodNumber;
        avgPrice: z.ZodNumber;
    }, z.core.$strip>>;
    orders: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        symbol: z.ZodString;
        side: z.ZodEnum<{
            BUY: "BUY";
            SELL: "SELL";
        }>;
        qty: z.ZodNumber;
        type: z.ZodEnum<{
            LIMIT: "LIMIT";
            MARKET: "MARKET";
        }>;
        limitPrice: z.ZodOptional<z.ZodNumber>;
        status: z.ZodEnum<{
            CANCELLED: "CANCELLED";
            FILLED: "FILLED";
            OPEN: "OPEN";
            REJECTED: "REJECTED";
        }>;
        reason: z.ZodOptional<z.ZodString>;
        createdAt: z.ZodNumber;
        filledAt: z.ZodOptional<z.ZodNumber>;
        fillPrice: z.ZodOptional<z.ZodNumber>;
        cancelledAt: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    previews: z.ZodRecord<z.ZodString, z.ZodObject<{
        id: z.ZodString;
        symbol: z.ZodString;
        side: z.ZodEnum<{
            BUY: "BUY";
            SELL: "SELL";
        }>;
        qty: z.ZodNumber;
        type: z.ZodEnum<{
            LIMIT: "LIMIT";
            MARKET: "MARKET";
        }>;
        limitPrice: z.ZodOptional<z.ZodNumber>;
        estimatedPrice: z.ZodNumber;
        estimatedValue: z.ZodNumber;
        createdAt: z.ZodNumber;
        expiresAt: z.ZodNumber;
    }, z.core.$strip>>;
    nextOrderNo: z.ZodNumber;
    nextPreviewNo: z.ZodNumber;
}, z.core.$strip>;
export type BrokerState = z.infer<typeof BrokerStateSchema>;
export declare function initialState(cash?: number): BrokerState;
/** Validate untrusted input (for example a state blob sent back by a browser). Throws on bad data. */
export declare function parseState(input: unknown): BrokerState;
