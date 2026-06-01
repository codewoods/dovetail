import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { LABELS_BY_LOCALE } from "../src/demo/labels.ts";

class TestNode {
	readonly children: TestNode[] = [];
	className = "";
	type = "";
	private ownText = "";

	constructor(readonly tagName: string) {}

	get firstChild(): TestNode | undefined {
		return this.children[0];
	}

	get textContent(): string {
		return (
			this.ownText + this.children.map((child) => child.textContent).join("")
		);
	}

	set textContent(value: string) {
		this.ownText = value;
		this.children.splice(0);
	}

	appendChild(node: TestNode): TestNode {
		this.children.push(node);
		return node;
	}

	removeChild(node: TestNode): TestNode {
		const index = this.children.indexOf(node);
		if (index >= 0) this.children.splice(index, 1);
		return node;
	}

	addEventListener(): void {}
}

type RenderQueue = (input: {
	root: TestNode;
	detail: TestNode;
	queue: {
		groups: Array<{
			label: string;
			adminAreaKey: string;
			totalPackets: number;
			highestSeverity: number;
			latestTs: number;
			clusters: Array<{
				kind: string;
				status: string;
				count: number;
				maxSeverity: number;
				latestTs: number;
			}>;
		}>;
	};
	currentLocale: string;
	t: (category: string, key: string) => string;
	severityLabel: (severity: number) => string;
}) => void;

const installDocument = (): void => {
	(globalThis as unknown as { document: unknown }).document = {
		createElement: (tagName: string) => new TestNode(tagName),
		createTextNode: (text: string) => {
			const node = new TestNode("#text");
			node.textContent = text;
			return node;
		},
	};
};

const renderModule = async (): Promise<{ renderQueue: RenderQueue }> => {
	const url = pathToFileURL(`${process.cwd()}/src/demo/demo-render.js`).href;
	return (await import(url)) as { renderQueue: RenderQueue };
};

const labels = LABELS_BY_LOCALE["zh-Hant-TW"];
const t = (category: string, key: string): string =>
	labels[category as keyof typeof labels]?.[key as never] || key;

describe("demo render helpers", () => {
	it("formats queue latest report time and display weight with the full 0-255 scale", async () => {
		installDocument();
		const { renderQueue } = await renderModule();
		const root = new TestNode("div");
		const detail = new TestNode("div");

		renderQueue({
			root,
			detail,
			queue: {
				groups: [
					{
						label: "光復鄉",
						adminAreaKey: "1003012",
						totalPackets: 2,
						highestSeverity: 170,
						latestTs: 1758611280,
						clusters: [
							{
								kind: "terrain_event:road_blocked",
								status: "queued",
								count: 2,
								maxSeverity: 170,
								latestTs: 1758611280,
							},
						],
					},
				],
			},
			currentLocale: "zh-Hant-TW",
			t,
			severityLabel: (severity) => `高 · 128-191/255 (${severity})`,
		});

		expect(root.textContent).toContain("最高顯示權重 高 · 128-191/255 (170)");
		expect(root.textContent).toContain("最新回報 2025/09/23 15:08");
		expect(detail.textContent).toContain("最高顯示權重高 · 128-191/255 (170)");
		expect(detail.textContent).toContain("最新回報2025/09/23 15:08");
	});

	it("treats en-US as an English display locale", async () => {
		installDocument();
		const { renderQueue } = await renderModule();
		const root = new TestNode("div");
		const detail = new TestNode("div");

		renderQueue({
			root,
			detail,
			queue: { groups: [] },
			currentLocale: "en-US",
			t: (category, key) =>
				LABELS_BY_LOCALE["en-US"][category as keyof typeof labels]?.[
					key as never
				] || key,
			severityLabel: String,
		});

		expect(root.textContent).toBe("No queued events");
	});
});
