import { afterEach, describe, expect, it, vi } from "vitest";
import { NpcBrain } from "../src/ai/llm";
import { ConversationController } from "../src/game/conversation";
import { Phone } from "../src/game/phone";
import { setLocale, t } from "../src/i18n";

afterEach(() => {
  setLocale("ja");
  vi.unstubAllGlobals();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const element = () => ({
  textContent: "",
  className: "",
  append: vi.fn(),
  remove: vi.fn(),
  scrollTop: 0,
  scrollHeight: 0,
});

describe("LLM reply languages", () => {
  it("reuses history in one language and replaces it when the same NPC changes language", async () => {
    const conversations = [0, 1].map(() => ({
      delete: vi.fn(async () => {}),
      sendMessageStreaming: async function* () {
        yield { content: ["Hello."] };
      },
    }));
    const createConversation = vi
      .fn()
      .mockResolvedValueOnce(conversations[0])
      .mockResolvedValueOnce(conversations[1]);
    const brain = new NpcBrain();
    Object.assign(brain, { engine: { createConversation } });
    setLocale("en");
    await brain.reply(7, "Reply in English.", "Hello", () => {});
    await brain.reply(7, "Reply in English.", "Again", () => {});
    expect(createConversation).toHaveBeenCalledTimes(1);
    setLocale("zh");
    await brain.reply(7, "请用中文回答。", "你好", () => {});
    expect(conversations[0]?.delete).toHaveBeenCalledOnce();
    expect(createConversation).toHaveBeenLastCalledWith({
      preface: { messages: [{ role: "system", content: "请用中文回答。" }] },
      sessionConfig: { maxOutputTokens: 120 },
    });
    await brain.forget(7);
    expect(conversations[1]?.delete).toHaveBeenCalledOnce();
  });

  it("checks and substitutes a delayed reply in the language requested before the switch", async () => {
    const text = deferred<string>();
    const conversation = {
      sendMessageStreaming: async function* () {
        yield { content: [await text.promise] };
      },
    };
    const brain = new NpcBrain();
    Object.assign(brain, {
      engine: { createConversation: vi.fn(async () => conversation) },
    });
    setLocale("en");
    const blocked = t("talk.blocked");
    const reply = brain.reply(7, "Reply in English.", "Hello", () => {});
    setLocale("ja");
    text.resolve("You are stupid.");
    expect(await reply).toBe(blocked);
  });
});

describe("delayed model speech", () => {
  it.each(["conversation", "phone"] as const)(
    "keeps the %s model reply on its original voice after changing the UI language",
    async (kind) => {
      const response = deferred<string | null>();
      const brain = { ready: true, reply: vi.fn<NpcBrain["reply"]>(() => response.promise) };
      const voice = { speak: vi.fn() };
      const log = element();
      vi.stubGlobal("document", {
        documentElement: { lang: "" },
        querySelectorAll: () => [],
        querySelector: () => log,
        createElement: element,
      });
      const controller =
        kind === "conversation"
          ? Object.assign(Object.create(ConversationController.prototype), {
              brain,
              voice,
              busy: false,
              voiceFrom: null,
              partner: { profile: { id: 7, name: "通行人", age: "20代", role: "会社員", mood: "穏やか" } },
              surroundings: () => ({
                ward: "千代田区",
                town: "",
                timeLabel: "昼",
                clock: "12:00",
                weather: "晴れ",
                nearbyPois: [],
                categories: [],
                lat: 35.68,
                lon: 139.76,
                busLine: null,
              }),
            })
          : Object.assign(Object.create(Phone.prototype), {
              brain,
              voice,
              busy: false,
              line: "119",
              callerText: "",
              dispatched: false,
              context: () => ({ location: "千代田区", clock: "12:00", hasIncident: false }),
            });
      setLocale("en");
      const pending: Promise<void> =
        kind === "conversation" ? controller.send("Hello") : controller.say("Hello");
      expect(brain.reply.mock.calls[0]?.[4]).toBe("en");
      setLocale("ja");
      response.resolve("The station is nearby.");
      await pending;
      expect(voice.speak).toHaveBeenCalledWith("The station is nearby.", undefined, "en");
    },
  );
});
