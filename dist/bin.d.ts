#!/usr/bin/env node
/**
 * stdio entry point, for Claude Desktop and other MCP clients.
 *
 *   paper-broker-mcp                     # in-memory account, reset on restart
 *   paper-broker-mcp --state ./acct.json # keep the account in a file
 *
 * stdout carries the MCP protocol, so all logging goes to stderr.
 */
export {};
