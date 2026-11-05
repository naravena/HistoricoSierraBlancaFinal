const test = require("node:test");
const assert = require("node:assert/strict");
const { totalsFromHA, range, summary } = require("../haos-bridge/summary");

function fakeSocket(reply) {
  return class extends EventTarget {
    static instances = [];
    constructor(url) {
      super();
      this.url = url;
      this.sent = [];
      this.closed = false;
      this.constructor.instances.push(this);
      queueMicrotask(() => this.emit({ type: "auth_required" }));
    }
    emit(message) {
      this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) }));
    }
    send(text) {
      const command = JSON.parse(text);
      this.sent.push(command);
      queueMicrotask(() => {
        if (command.type === "auth") this.emit({ type: "auth_ok" });
        else this.emit(reply(command));
      });
    }
    close() { this.closed = true; }
  };
}

test("summary obtains two scalar changes through one connection, without raw history", async () => {
  const Socket = fakeSocket(command => ({
    id: command.id, type: "result", success: true,
    result: { change: command.id === 1 ? 125.75 : 90.25 },
  }));
  const dates = range({ desde: "2026-08-09", hasta: "2026-09-07" });
  const totals = await totalsFromHA("http://ha:8123/", "test-token", dates, Socket);
  assert.deepEqual(totals, [125.75, 90.25]);
  assert.equal(Socket.instances.length, 1);
  const instance = Socket.instances[0];
  assert.equal(instance.url.href, "ws://ha:8123/api/websocket");
  assert.equal(instance.sent.length, 3); // auth and two aggregate commands
  for (const command of instance.sent.slice(1)) {
    assert.equal(command.type, "recorder/statistic_during_period");
    assert.deepEqual(command.types, ["change"]);
    assert.deepEqual(command.units, { energy: "kWh" });
    assert.deepEqual(command.fixed_period, {
      start_time: "2026-08-08T22:00:00.000Z", end_time: "2026-09-07T22:00:00.000Z",
    });
    assert.equal(Object.hasOwn(command, "start_time"), false);
    assert.equal(Object.hasOwn(command, "end_time"), false);
  }
  assert.equal(instance.closed, true);
});

test("missing statistics remain null while a real zero is retained", async () => {
  const Socket = fakeSocket(command => ({
    id: command.id, type: "result", success: true, result: command.id === 1 ? {} : { change: 0 },
  }));
  assert.deepEqual(await totalsFromHA("https://ha.test", "test", range({
    desde: "2026-11-04", hasta: "2026-11-04",
  }), Socket), [null, 0]);
});

test("unsupported statistics command rejects and closes the connection", async () => {
  const Socket = fakeSocket(command => ({
    id: command.id, type: "result", success: false, error: { code: "unknown_command" },
  }));
  await assert.rejects(totalsFromHA("http://ha", "test", {}, Socket), /statistics_unavailable/);
  assert.equal(Socket.instances[0].closed, true);
});

test("range permits 366 days, rejects invalid dates and uses DST boundaries", () => {
  assert.ok(range({ desde: "2026-01-01", hasta: "2027-01-01" }));
  assert.equal(range({ desde: "2026-01-01", hasta: "2027-01-02" }), null);
  assert.equal(range({ desde: "2026-02-30", hasta: "2026-03-01" }), null);
  const march = range({ desde: "2026-03-29", hasta: "2026-03-29" });
  const october = range({ desde: "2026-10-25", hasta: "2026-10-25" });
  assert.equal(Date.parse(march.end) - Date.parse(march.start), 23 * 3600000);
  assert.equal(Date.parse(october.end) - Date.parse(october.start), 25 * 3600000);
});

test("old bridge version produces an actionable update error with no raw fallback", async t => {
  const previous = { url: process.env.HA_BRIDGE_URL, secret: process.env.HA_BRIDGE_SECRET, fetch: global.fetch };
  process.env.HA_BRIDGE_URL = "https://bridge.test:8443";
  process.env.HA_BRIDGE_SECRET = "x".repeat(40);
  t.after(() => {
    if (previous.url === undefined) delete process.env.HA_BRIDGE_URL;
    else process.env.HA_BRIDGE_URL = previous.url;
    if (previous.secret === undefined) delete process.env.HA_BRIDGE_SECRET;
    else process.env.HA_BRIDGE_SECRET = previous.secret;
    global.fetch = previous.fetch;
  });
  let calls = 0;
  global.fetch = async (url, options) => {
    calls++;
    assert.equal(url.pathname, "/api/ha/summary");
    assert.equal(options.redirect, "error");
    return new Response("", { status: 404 });
  };
  const response = {
    set() {}, status(code) { this.code = code; return this; }, json(data) { this.data = data; },
  };
  await summary({ query: { desde: "2026-08-09", hasta: "2026-09-07" } }, response);
  assert.equal(response.code, 503);
  assert.match(response.data.error, /1.1.0/);
  assert.equal(calls, 1);
});
