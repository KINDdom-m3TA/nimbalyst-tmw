// @vitest-environment node
/**
 * Scene rendering is a pure string function, so it is cheap to pin the things
 * that would otherwise only fail visually:
 *  - every part carries the `data-part`/`data-state` hooks playback drives,
 *  - edge geometry works when nodes are stacked, not just side by side,
 *  - user text cannot break out of the markup.
 */

import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PACKET_COUNT,
  PACKET_TRAVEL_S,
  escapeXml,
  renderPart,
  renderScene,
  sceneAriaLabel,
} from "../render/scene";
import { parseDocument } from "../core/parse";
import { serializeDocument } from "../core/serialize";
import { buildStandaloneDocument, buildTimeline } from "../render/standalone";
import type { AnimDocument } from "../core/types";
import { buildStageDocument } from "../render/stageDocument";
import { setStageAnimationsPaused } from "../render/stageDocument";
import { FALLBACK_TOKENS } from "../render/stageCss";

function docOf(json: string): AnimDocument {
  return parseDocument(json).doc;
}

const TWO_NODES = `{
  "stage": { "width": 500, "height": 300, "fps": 25 },
  "parts": {
    "a": { "type": "node", "label": "Left", "x": 20, "y": 100, "w": 100, "h": 60 },
    "b": { "type": "node", "label": "Right", "x": 380, "y": 100, "w": 100, "h": 60 },
    "e": { "type": "edge", "from": "a", "to": "b", "text": "GET" }
  },
  "steps": [{ "id": "s", "duration": 100 }]
}`;

describe("renderScene", () => {
  it("tags every part with the attributes playback drives", () => {
    // Playback works by setting these attributes. If a part renders without
    // them it is invisible to the scheduler and simply never animates.
    const svg = renderScene(docOf(TWO_NODES));
    for (const id of ["a", "b", "e"]) {
      expect(svg).toContain(`data-part="${id}"`);
    }
    expect(svg.match(/data-state="idle"/g)).toHaveLength(3);
    expect(svg.match(/data-tone="neutral"/g)).toHaveLength(3);
  });

  it("draws edges behind nodes", () => {
    const svg = renderScene(docOf(TWO_NODES));
    expect(svg.indexOf('data-part="e"')).toBeLessThan(
      svg.indexOf('data-part="a"')
    );
  });

  it("uses canonical part order before and after serialization", () => {
    const source = `{"parts":{
      "z":{"type":"shape","x":0,"y":0,"w":20,"h":20},
      "a":{"type":"shape","x":0,"y":0,"w":20,"h":20}
    },"steps":[]}`;
    const parsed = parseDocument(source);
    const before = renderScene(parsed.doc);
    const after = renderScene(
      parseDocument(serializeDocument(parsed.doc, parsed.extras)).doc
    );
    expect(before.indexOf('data-part="a"')).toBeLessThan(
      before.indexOf('data-part="z"')
    );
    expect(after).toBe(before);
  });

  it("omits an edge whose endpoint does not exist", () => {
    // Rendering it anyway would draw a line to the origin, which reads as a
    // rendering bug rather than as a document problem.
    const svg = renderScene(
      docOf(
        `{"parts":{"e":{"type":"edge","from":"a","to":"missing"}},"steps":[]}`
      )
    );
    expect(svg).not.toContain('data-part="e"');
  });

  it("anchors a vertical edge to the horizontal borders", () => {
    // The classic bug here is assuming left-to-right and drawing through the
    // node body the first time someone stacks two boxes.
    const stacked = docOf(`{
      "parts": {
        "top": { "type": "node", "x": 100, "y": 0, "w": 100, "h": 50 },
        "bottom": { "type": "node", "x": 100, "y": 200, "w": 100, "h": 50 },
        "e": { "type": "edge", "from": "top", "to": "bottom" }
      },
      "steps": []
    }`);
    const svg = renderPart("e", stacked);
    // Centres are x=150; the line should run straight down between the facing
    // borders: y=50 (bottom of top) to y=200 (top of bottom).
    expect(svg).toContain("M150.0 50.0 L150.0 200.0");
  });

  it("escapes text so a label cannot break the markup", () => {
    const svg = renderScene(
      docOf(
        `{"parts":{"l":{"type":"label","x":0,"y":0,"text":"a <b> & \\"c\\""}},"steps":[]}`
      )
    );
    expect(svg).toContain("a &lt;b&gt; &amp; &quot;c&quot;");
    expect(svg).not.toContain("<b>");
  });

  it("escapes a part id used in an attribute", () => {
    const svg = renderScene(
      docOf(
        `{"parts":{"a\\"b":{"type":"node","x":0,"y":0,"w":10,"h":10}},"steps":[]}`
      )
    );
    expect(svg).toContain('data-part="a&quot;b"');
  });

  it("carries the stage viewBox", () => {
    expect(renderScene(docOf(TWO_NODES))).toContain('viewBox="0 0 500 300"');
  });

  it("does not let a background value escape the stage style block", () => {
    const doc = docOf(
      `{"stage":{"width":100,"height":100,"fps":25,"background":"red;}<\\/style><script>bad()<\\/script>"},"parts":{},"steps":[]}`
    );
    const html = buildStageDocument(doc, FALLBACK_TOKENS);
    expect(html).not.toContain("<script>bad()");
    expect(html).toContain(`--anim-bg: ${FALLBACK_TOKENS.bg}`);
  });
});

describe("stage animation control", () => {
  it("pauses and resumes CSS transitions and packet animations together", () => {
    const animations = [
      { pause: vi.fn(), play: vi.fn() },
      { pause: vi.fn(), play: vi.fn() },
    ];
    const frameDoc = { getAnimations: () => animations } as unknown as Document;
    setStageAnimationsPaused(frameDoc, true);
    expect(
      animations.every((animation) => animation.pause.mock.calls.length === 1)
    ).toBe(true);
    setStageAnimationsPaused(frameDoc, false);
    expect(
      animations.every((animation) => animation.play.mock.calls.length === 1)
    ).toBe(true);
  });
});

describe("edge packets", () => {
  it("rides the same path the line is drawn from", () => {
    // If the packets and the line ever computed their geometry separately they
    // would drift apart on any change to the anchor maths, and the packets
    // would visibly travel beside the wire instead of along it.
    const svg = renderPart("e", docOf(TWO_NODES));
    const lineD = /class="anim-edge-line" d="([^"]+)"/.exec(svg)?.[1];
    expect(lineD).toBeTruthy();
    expect(svg).toContain(`offset-path: path('${lineD}')`);
  });

  it("staggers packets with negative delays so the wire starts full", () => {
    // A positive delay would leave the edge empty for a beat after it turns on.
    const svg = renderPart("e", docOf(TWO_NODES));
    const delays = [...svg.matchAll(/animation-delay: (-?[\d.]+)s/g)].map((m) =>
      Number(m[1])
    );
    expect(delays).toHaveLength(DEFAULT_PACKET_COUNT);
    expect(delays[0]).toBe(0);
    expect(delays.every((d) => d <= 0)).toBe(true);
    // Evenly spaced across one travel cycle.
    expect(delays[1]).toBeCloseTo(-PACKET_TRAVEL_S / DEFAULT_PACKET_COUNT, 3);
  });

  it("honours an explicit packet count", () => {
    const doc = docOf(`{
      "parts": {
        "a": { "type": "node", "x": 0, "y": 0, "w": 10, "h": 10 },
        "b": { "type": "node", "x": 100, "y": 0, "w": 10, "h": 10 },
        "e": { "type": "edge", "from": "a", "to": "b", "packets": 6 }
      },
      "steps": []
    }`);
    // Matched with the closing quote so the `anim-edge-packets` group wrapper
    // is not counted as a seventh packet.
    expect(
      renderPart("e", doc).match(/class="anim-edge-packet"/g)
    ).toHaveLength(6);
  });

  it("omits packets entirely for an edge that carries no traffic", () => {
    // An edge can mean "relates to" rather than "sends to"; those should not
    // sprout moving squares.
    const doc = docOf(`{
      "parts": {
        "a": { "type": "node", "x": 0, "y": 0, "w": 10, "h": 10 },
        "b": { "type": "node", "x": 100, "y": 0, "w": 10, "h": 10 },
        "e": { "type": "edge", "from": "a", "to": "b", "packets": 0 }
      },
      "steps": []
    }`);
    const svg = renderPart("e", doc);
    expect(svg).not.toContain("anim-edge-packet");
    expect(svg).toContain("anim-edge-line");
  });

  it("normalises the flow path so the reveal is length-independent", () => {
    // Without pathLength="1" the dash values are pixels, and the "reveal" turns
    // into a 1px dotted line -- which is exactly what it did before this.
    expect(renderPart("e", docOf(TWO_NODES))).toContain(
      'class="anim-edge-flow" pathLength="1"'
    );
  });

  it("round-trips the packet count through parse and serialize", () => {
    const { doc, extras } = parseDocument(
      `{"parts":{"a":{"type":"node","x":0,"y":0,"w":10,"h":10},` +
        `"b":{"type":"node","x":99,"y":0,"w":10,"h":10},` +
        `"e":{"type":"edge","from":"a","to":"b","packets":5}},"steps":[]}`
    );
    expect((doc.parts.e as { packets?: number }).packets).toBe(5);
    expect(JSON.parse(serializeDocument(doc, extras)).parts.e.packets).toBe(5);
  });
});

describe("sceneAriaLabel", () => {
  it("narrates the step captions so the animation is readable without sight", () => {
    const doc = docOf(`{
      "parts": { "a": { "type": "node", "x": 0, "y": 0, "w": 10, "h": 10 } },
      "steps": [
        { "id": "one", "duration": 100, "caption": "It starts." },
        { "id": "two", "duration": 100, "caption": "It finishes." }
      ]
    }`);
    const label = sceneAriaLabel(doc);
    expect(label).toContain("1 parts");
    expect(label).toContain("2 steps");
    expect(label).toContain("It starts. It finishes.");
  });
});

describe("escapeXml", () => {
  it("escapes all five XML metacharacters", () => {
    expect(escapeXml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&apos;");
  });
});

describe("standalone export", () => {
  const EXPORTABLE = `{
    "version": 1,
    "stage": { "width": 100, "height": 100, "fps": 25 },
    "parts": {
      "a": { "type": "node", "x": 0, "y": 0, "w": 10, "h": 10 },
      "b": { "type": "node", "x": 20, "y": 0, "w": 10, "h": 10 }
    },
    "steps": [
      { "id": "one", "duration": 500, "set": { "a": { "state": "active" } } },
      { "id": "two", "duration": 700, "set": { "b": { "state": "active", "tone": "success" } } }
    ]
  }`;

  function timelineOf(source: string) {
    return buildTimeline(parseDocument(source).doc);
  }

  it("makes the first entry complete and the rest deltas", () => {
    // The loop has no separate reset path: wrapping round re-applies entry 0.
    // If someone "optimises" entry 0 into a delta, playback silently smears the
    // end of one pass into the start of the next, and only on the second loop.
    const timeline = timelineOf(EXPORTABLE);

    expect(Object.keys(timeline[0].s).sort()).toEqual(["a", "b"]);
    // `a` did not change in step two, so it must not be re-asserted there.
    expect(Object.keys(timeline[1].s)).toEqual(["b"]);
    expect(timeline.map((entry) => entry.t)).toEqual([0, 500]);
  });

  it("cannot be broken out of by a part id containing a script tag", () => {
    // Part ids are user-authored and land inside a <script> block as JSON.
    const hostile = `{
      "version": 1,
      "stage": { "width": 10, "height": 10, "fps": 25 },
      "parts": { "</script><img src=x>": { "type": "node", "x": 0, "y": 0, "w": 1, "h": 1 } },
      "steps": [{ "id": "s", "duration": 100, "set": { "</script><img src=x>": { "state": "active" } } }]
    }`;
    const html = buildStandaloneDocument(parseDocument(hostile).doc, FALLBACK_TOKENS);

    const scriptBody = html.slice(html.indexOf("<script>"));
    expect(scriptBody.indexOf("</script>")).toBe(scriptBody.lastIndexOf("</script>"));
    expect(html).not.toContain("<img src=x>");
  });

  it("carries the scene, the theme and the total, with no external references", () => {
    const html = buildStandaloneDocument(parseDocument(EXPORTABLE).doc, FALLBACK_TOKENS, {
      title: "demo",
    });

    expect(html).toContain('data-part="a"');
    expect(html).toContain("--anim-tone-success");
    expect(html).toContain("var TOTAL = 1200;");
    expect(html).toContain("<title>demo</title>");
    // Self-contained is the whole point of the format.
    expect(html).not.toMatch(/<(script|link)[^>]+(src|href)=/);
  });
});
