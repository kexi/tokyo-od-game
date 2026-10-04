import { describe, expect, it } from "vitest";
import { renderTicketHtml } from "../src/game/ticketForm";
import type { ViolationRecord } from "../src/game/traffic";

describe("ticketForm", () => {
  it("renders blue ticket for standard violations", () => {
    const violations: ViolationRecord[] = [
      {
        kind: "signal",
        label: "信号無視（赤色等）",
        article: "道路交通法 第7条",
        points: 2,
        fine: 9000,
        at: 1000,
        status: "caught",
        context: {
          clock: "10/4(日) 14:20",
          place: "港区新橋一丁目",
          lat: 35.666,
          lon: 139.758,
          kmh: 35,
          limit: 40,
          limitKind: "標識",
        },
      },
    ];

    const html = renderTicketHtml({ violations });
    expect(html).toContain("ticket-blue");
    expect(html).not.toContain("ticket-red");
    expect(html).toContain("青切符");
    expect(html).toContain("交通反則告知書（兼 免許証保管証）");
    expect(html).toContain("品川 330 さ 12-34");
    expect(html).toContain("信号無視（赤色等）");
    expect(html).toContain("¥9,000");
    expect(html).toContain("反則金仮納付書");
    expect(html).toContain("港区新橋一丁目");
    expect(html).toContain("道路交通法 第7条");
  });

  it("renders red ticket for non-fine criminal offenses", () => {
    const violations: ViolationRecord[] = [
      {
        kind: "speed",
        label: "速度超過（35km/h超過）",
        article: "道路交通法 第22条（最高速度）",
        points: 6,
        fine: null,
        at: 2000,
        status: "caught",
        context: {
          clock: "10/4(日) 16:45",
          place: "千代田区霞が関一丁目",
          lat: 35.675,
          lon: 139.75,
          kmh: 85,
          limit: 50,
          limitKind: "標識",
        },
      },
    ];

    const html = renderTicketHtml({ violations });
    expect(html).toContain("ticket-red");
    expect(html).not.toContain("ticket-blue");
    expect(html).toContain("赤切符");
    expect(html).toContain("告知票（兼 免許証保管証）");
    expect(html).toContain("出頭通知票・手続案内書（非反則行為）");
    expect(html).not.toContain("反則金仮納付書");
    expect(html).toContain("千代田区霞が関一丁目");
    expect(html).toContain("85 km/h");
  });

  it("writes names from map data as text, never as markup", () => {
    const hostile = '<img src=x onerror="alert(1)">';
    const violations: ViolationRecord[] = [
      {
        kind: "signal",
        label: `信号無視${hostile}`,
        article: `道路交通法 第7条${hostile}`,
        points: 2,
        fine: 9000,
        at: 1000,
        status: "caught",
        context: {
          clock: `10/4(日) 14:20${hostile}`,
          place: `${hostile}交差点`,
          lat: 35.666,
          lon: 139.758,
          kmh: 40,
          limit: 40,
          limitKind: "標識",
          detail: hostile,
        },
      },
    ];
    const html = renderTicketHtml({ violations, driverAddress: hostile });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;交差点");
  });
});
