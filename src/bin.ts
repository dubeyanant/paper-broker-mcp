#!/usr/bin/env node
/**
 * stdio entry point, for Claude Desktop and other MCP clients.
 *
 *   paper-broker-mcp                     # in-memory account, reset on restart
 *   paper-broker-mcp --state ./acct.json # keep the account in a file
 *
 * stdout carries the MCP protocol, so all logging goes to stderr.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PaperBroker } from "./broker/broker.ts";
import { createServer } from "./server.ts";
import { VERSION } from "./version.ts";

const USAGE = `paper-broker-mcp ${VERSION}
MCP server for a simulated NSE paper trading account. Simulated prices, no real money.

Usage: paper-broker-mcp [--state <file.json>]

Options:
  --state <file>  Load the account from this JSON file and save it after every change.
  --help          Show this message.
  --version       Print the version.`;

function parseArgs(argv: string[]): { statePath?: string } {
  let statePath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
    } else if (arg === "--version" || arg === "-v") {
      process.stdout.write(`${VERSION}\n`);
      process.exit(0);
    } else if (arg === "--state") {
      statePath = argv[++i];
      if (!statePath) fatal("--state needs a file path");
    } else if (arg.startsWith("--state=")) {
      statePath = arg.slice("--state=".length);
    } else {
      fatal(`unknown argument: ${arg}\n\n${USAGE}`);
    }
  }
  return statePath ? { statePath: resolve(statePath) } : {};
}

function fatal(message: string): never {
  process.stderr.write(`paper-broker-mcp: ${message}\n`);
  process.exit(1);
}

function loadBroker(statePath: string | undefined): PaperBroker {
  if (!statePath || !existsSync(statePath)) return PaperBroker.fromState(null);
  try {
    return PaperBroker.fromState(JSON.parse(readFileSync(statePath, "utf8")));
  } catch (err) {
    fatal(`could not read state from ${statePath}: ${(err as Error).message}`);
  }
}

function save(statePath: string, json: string): void {
  const tmp = `${statePath}.tmp`;
  writeFileSync(tmp, json);
  renameSync(tmp, statePath);
}

async function main(): Promise<void> {
  const { statePath } = parseArgs(process.argv.slice(2));
  const broker = loadBroker(statePath);
  const server = createServer(broker);
  const transport = new StdioServerTransport();

  if (statePath) {
    // Save after every message the server sends, but only when the account changed.
    let last = JSON.stringify(broker.toState(), null, 2);
    const send = transport.send.bind(transport);
    transport.send = async (message) => {
      await send(message);
      const next = JSON.stringify(broker.toState(), null, 2);
      if (next !== last) {
        save(statePath, `${next}\n`);
        last = next;
      }
    };
  }

  await server.connect(transport);
  process.stderr.write(
    `paper-broker-mcp ${VERSION} running on stdio${statePath ? `, state in ${statePath}` : " (in-memory state)"}\n`,
  );
}

main().catch((err) => fatal((err as Error).stack ?? String(err)));
