import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PaperBroker } from "../broker/broker.js";
import { initialState } from "../broker/state.js";
import { hasDevanagari } from "../language.js";
import { createServer } from "../server.js";
import { VERSION } from "../version.js";
import { buildSystemPrompt } from "./prompt.js";
import { createAnthropicProvider } from "./providers/anthropic.js";
import { createGeminiProvider } from "./providers/gemini.js";
import { cancelledReply, createRulesProvider, placedReply } from "./providers/rules.js";
import { toSpeakable } from "./speech.js";
export const DEFAULT_MAX_STEPS = 6;
export const DEFAULT_MAX_HISTORY = 20;
/** Hard cap on tool calls in one turn, whatever the model does. */
const MAX_TOOL_CALLS = 12;
/** Tools that change the account. Once one succeeds, a turn can't be replayed from the start. */
export const STATE_CHANGING_TOOLS = new Set(["place_order", "cancel_order"]);
function readEnv(env) {
    if (env)
        return env;
    return typeof process !== "undefined" ? process.env : {};
}
/**
 * Pick a provider from the environment: Anthropic if ANTHROPIC_API_KEY is
 * set, else Gemini if GEMINI_API_KEY is set, else the offline rules parser.
 */
export function pickProvider(env) {
    const e = readEnv(env);
    if (e.ANTHROPIC_API_KEY) {
        return createAnthropicProvider({ apiKey: e.ANTHROPIC_API_KEY, ...(e.ANTHROPIC_MODEL ? { model: e.ANTHROPIC_MODEL } : {}) });
    }
    if (e.GEMINI_API_KEY) {
        return geminiFromEnv(e, e.GEMINI_API_KEY);
    }
    return createRulesProvider();
}
function providerByName(name, env) {
    const e = readEnv(env);
    switch (name) {
        case "rules":
            return createRulesProvider();
        case "anthropic":
            if (!e.ANTHROPIC_API_KEY)
                throw new Error("provider 'anthropic' needs ANTHROPIC_API_KEY");
            return createAnthropicProvider({ apiKey: e.ANTHROPIC_API_KEY, ...(e.ANTHROPIC_MODEL ? { model: e.ANTHROPIC_MODEL } : {}) });
        case "gemini":
            if (!e.GEMINI_API_KEY)
                throw new Error("provider 'gemini' needs GEMINI_API_KEY");
            return geminiFromEnv(e, e.GEMINI_API_KEY);
    }
}
function geminiFromEnv(e, apiKey) {
    return createGeminiProvider({
        apiKey,
        ...(e.GEMINI_MODEL ? { model: e.GEMINI_MODEL } : {}),
        ...(e.GEMINI_THINKING_LEVEL ? { thinkingLevel: e.GEMINI_THINKING_LEVEL } : {}),
    });
}
function textOf(result) {
    return result.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
}
/** Hindi if the UI asks for it or the user just wrote in Devanagari; otherwise English. */
export function replyLanguage(hint, latest) {
    return hint === "hi" || hasDevanagari(latest) ? "hi" : "en";
}
function splitState(input) {
    if (input == null || typeof input !== "object")
        return { broker: input ?? null, pendingPreviewId: null };
    const { pendingPreviewId, ...broker } = input;
    return { broker, pendingPreviewId: typeof pendingPreviewId === "string" ? pendingPreviewId : null };
}
function checkMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0)
        throw new Error("messages must be a non-empty array");
    for (const m of messages) {
        if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") {
            throw new Error("each message needs role 'user' or 'assistant' and string content");
        }
    }
    if (messages.at(-1).role !== "user")
        throw new Error("the last message must be from the user");
}
/** Keep the most recent messages, starting on a user message. */
function trimHistory(messages, max) {
    let recent = messages.slice(-Math.max(1, max));
    const firstUser = recent.findIndex((m) => m.role === "user");
    if (firstUser > 0)
        recent = recent.slice(firstUser);
    return recent;
}
/**
 * Load the account, keep only the pending preview, and connect an MCP client
 * to a fresh server over an in-memory transport.
 */
async function openSession(state, pending, now, language, news) {
    const broker = new PaperBroker(state, { now });
    // Only the pending preview survives into this turn; anything else is stale.
    for (const id of Object.keys(broker.toState().previews)) {
        if (id !== pending?.id)
            broker.discardPreview(id);
    }
    const server = createServer(broker, news ? { news } : {});
    const client = new Client({ name: "paper-broker-agent", version: VERSION });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const events = [];
    let toolCalls = 0;
    let committed = null;
    const callTool = async (name, args) => {
        // News and tip checks follow the conversation's language unless the model chose one.
        if ((name === "get_news" || name === "check_tip") && args.language === undefined)
            args = { ...args, language };
        events.push({ type: "tool_call", name, args });
        const finish = (outcome) => {
            events.push({ type: "tool_result", name, result: outcome.result, isError: outcome.isError });
            if (!outcome.isError && STATE_CHANGING_TOOLS.has(name))
                committed = { name, result: outcome.result };
            return outcome;
        };
        if (++toolCalls > MAX_TOOL_CALLS) {
            const text = "Too many tool calls in one turn. Answer the user with what you have.";
            return finish({ result: { error: { code: "TOO_MANY_CALLS", message: text } }, text, isError: true });
        }
        if (name === "place_order" && (!pending || args.preview_id !== pending.id)) {
            const text = pending
                ? `Only the pending preview ${pending.id} can be placed, and only after the user confirms it.`
                : "There is no confirmed preview to place. Make a preview with preview_order and ask the user to confirm it first.";
            return finish({ result: { error: { code: "NOT_CONFIRMED", message: text } }, text, isError: true });
        }
        try {
            const res = (await client.callTool({ name, arguments: args }));
            const text = textOf(res);
            return finish({ result: res.structuredContent ?? text, text, isError: res.isError === true });
        }
        catch (err) {
            const text = err instanceof Error ? err.message : String(err);
            return finish({ result: { error: { code: "TOOL_FAILED", message: text } }, text, isError: true });
        }
    };
    const listed = await client.listTools();
    const tools = listed.tools.map((t) => {
        const { $schema: _ignored, ...schema } = t.inputSchema;
        return { name: t.name, description: t.description ?? "", inputSchema: schema };
    });
    return {
        broker,
        events,
        tools,
        callTool,
        committed: () => committed,
        before: new Set(Object.keys(broker.toState().previews)),
        close: async () => {
            await client.close();
            await server.close();
        },
    };
}
/** A reply built from a place_order or cancel_order result, for when the model failed right after it. */
function committedReply(done, lang) {
    const order = done.result?.order;
    if (!order)
        return "Done.";
    return done.name === "cancel_order" ? cancelledReply(order, lang) : placedReply(order, lang);
}
/**
 * Run one conversational turn: connect an MCP client to a fresh server over an
 * in-memory transport, let the provider call tools, and return the reply,
 * the tool events and the updated state.
 *
 * Safety: `place_order` is only allowed for the preview the user was asked
 * about in the previous turn. A preview made during this turn can't be placed
 * until the user answers, whatever the model decides.
 *
 * If the model fails, the rules parser answers instead, replayed from the
 * original state so its events stand on their own. The exception is a failure
 * after an order was placed or cancelled: that can't be undone, so the reply
 * describes it.
 */
export async function runAgentTurn(options) {
    checkMessages(options.messages);
    const now = options.now ?? Date.now;
    const language = replyLanguage(options.language, options.messages.at(-1).content);
    const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    const { broker: brokerState, pendingPreviewId } = splitState(options.state);
    // Validate once up front, so bad state is the caller's error rather than a model failure.
    const initial = PaperBroker.fromState(brokerState ?? initialState(), { now }).toState();
    // An expired pending preview is kept so the user hears "expired" rather than "nothing to confirm".
    const pending = (pendingPreviewId && initial.previews[pendingPreviewId]) || null;
    const provider = typeof options.provider === "object"
        ? options.provider
        : options.provider
            ? providerByName(options.provider, options.env)
            : pickProvider(options.env);
    const makeTurn = (session) => ({
        system: buildSystemPrompt(pending, now(), language),
        messages: trimHistory(options.messages, options.maxHistory ?? DEFAULT_MAX_HISTORY),
        tools: session.tools,
        callTool: session.callTool,
        maxSteps,
        pendingPreview: pending,
        language,
    });
    const unwrap = (out) => (typeof out === "string" ? { reply: out } : out);
    let session = await openSession(initial, pending, now, language, options.news);
    let reply;
    let used = provider;
    let model = provider.model;
    let error;
    try {
        const out = unwrap(await provider.run(makeTurn(session)));
        reply = out.reply;
        model = out.model ?? provider.model;
    }
    catch (err) {
        error = err instanceof Error ? err.message : String(err);
        const done = session.committed();
        if (done) {
            // An order was placed or cancelled before the failure. Say so rather than apologise.
            reply = committedReply(done, language);
        }
        else if (provider.name !== "rules") {
            // Nothing changed, so answer with the rules parser, starting again from the original state.
            await session.close();
            session = await openSession(initial, pending, now, language, options.news);
            used = createRulesProvider();
            model = undefined;
            reply = unwrap(await used.run(makeTurn(session))).reply;
        }
        else {
            reply = "Sorry, something went wrong on my side. Please try again.";
        }
    }
    finally {
        await session.close();
    }
    const { broker, events, before } = session;
    // The newest preview made this turn becomes the pending one. Older ones are dropped.
    const created = broker.activePreviews().filter((p) => !before.has(p.id));
    const nextPending = created.at(-1) ?? null;
    for (const id of Object.keys(broker.toState().previews)) {
        if (id !== nextPending?.id)
            broker.discardPreview(id);
    }
    const spoken = toSpeakable(reply, language);
    return {
        reply: spoken,
        events,
        state: { ...broker.toState(), pendingPreviewId: nextPending?.id ?? null },
        messages: [...options.messages, { role: "assistant", content: spoken }],
        provider: used.name,
        language,
        ...(model ? { model } : {}),
        ...(error ? { error } : {}),
    };
}
