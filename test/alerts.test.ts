import { describe, expect, it } from "vitest";
import { analyse } from "../src/analysis/api.ts";
import type { PacketJson } from "../src/packet/types.ts";

const envelope = {
	received_at: "2026-09-23T14:32:11Z",
	gateway_id: "G1",
	aead_profile: "aead-ccm-128" as const,
	chain_mac: "cd",
};

const publicReferencePoint = { lat: 23.661234, lng: 121.421789 } as const;
const syntheticPoint = { lat: 0.125, lng: 0.25 } as const;
const outsideSupportedAreaPoint = { lat: 0.5, lng: 0.5 } as const;

describe("alerts", () => {
	it("emits critical alert with small counts bucketed when any person status = rescue_needed", () => {
		const result = analyse([
			{
				type: "person_report",
				envelope,
				packet: {
					mac: "M1",
					village: 1,
					ts: 1,
					...syntheticPoint,
					alt: 100,
					addr: "X",
					count: 2,
					status: "rescue_needed",
					flags: [],
				},
			},
		]);
		const ids = result.alerts.map((a) => a.id);
		expect(ids).toContain("rescue_needed");
		const rescueAlert = result.alerts.find((a) => a.id === "rescue_needed");
		expect(rescueAlert?.severity).toBe("critical");
		expect(rescueAlert?.message).toBe("<5 人需要救援");
	});

	it("emits info alert when consent_refused > 0", () => {
		const packets: PacketJson[] = [
			{
				type: "person_report",
				envelope,
				packet: {
					mac: "M1",
					village: 1,
					ts: 1,
					...syntheticPoint,
					alt: 100,
					addr: "X",
					count: 1,
					status: "unknown",
					flags: ["consent_refused"],
				},
			},
		];
		const result = analyse(packets);
		const consentAlert = result.alerts.find((a) => a.id === "consent_refused");
		expect(consentAlert?.severity).toBe("info");
		expect(consentAlert?.message).toBe(
			"<5 名當事人拒絕被通報 (status 維持 unknown)",
		);
	});

	it("flags overlay packets inside known hazard zones", () => {
		const result = analyse([
			{
				type: "person_report",
				envelope,
				packet: {
					mac: "M1",
					village: 1,
					ts: 1,
					...publicReferencePoint,
					alt: 100,
					addr: "X",
					count: 1,
					status: "evacuated_shelter",
					flags: [],
				},
			},
		]);
		expect(
			result.alerts.find((a) => a.id === "packets_in_hazard_zone"),
		).toBeDefined();
	});

	it("produces empty alert list for benign packets", () => {
		const result = analyse([
			{
				type: "person_report",
				envelope,
				packet: {
					mac: "M1",
					village: 1,
					ts: 1,
					...outsideSupportedAreaPoint,
					alt: 10,
					addr: "X",
					count: 1,
					status: "evacuated_relatives",
					flags: [],
				},
			},
		]);
		expect(result.alerts).toHaveLength(0);
	});

	it("emits critical alert when terrain flags report trapped vehicles", () => {
		const result = analyse([
			{
				type: "terrain_event",
				envelope,
				packet: {
					mac: "M2",
					ts: 1,
					...syntheticPoint,
					event: "landslide",
					extent_m: 200,
					severity: 230,
					flags: ["vehicles_trapped", "only_exit_control"],
				},
			},
		]);
		expect(
			result.alerts.find((a) => a.id === "vehicles_trapped")?.severity,
		).toBe("critical");
	});

	it("emits warning alert when drainage backflow severity is high", () => {
		const result = analyse([
			{
				type: "terrain_event",
				envelope,
				packet: {
					mac: "M3",
					ts: 1,
					...syntheticPoint,
					event: "drainage_backflow",
					extent_m: 350,
					severity: 210,
					flags: ["rapid_rainfall", "backflow_observed"],
				},
			},
		]);
		expect(
			result.alerts.find((a) => a.id === "drainage_backflow")?.severity,
		).toBe("warning");
	});

	it("emits warning alert when urgent warmth supplies are requested", () => {
		const result = analyse([
			{
				type: "resource_report",
				envelope,
				packet: {
					mac: "M4",
					ts: 1,
					...syntheticPoint,
					addr: "UNKNOWN_FLOOD",
					resource: ["warmth_supplies"],
					quantity: 11,
					duration: 0,
					flags: ["is_request", "urgent"],
				},
			},
		]);
		expect(
			result.alerts.find((a) => a.id === "urgent_warmth_supplies")?.severity,
		).toBe("warning");
	});

	it("emits warning alert when urgent menstrual supplies are requested", () => {
		const result = analyse([
			{
				type: "resource_report",
				envelope,
				packet: {
					mac: "M5",
					ts: 1,
					...syntheticPoint,
					addr: "UNKNOWN_FLOOD",
					resource: ["menstrual_supplies"],
					quantity: 20,
					duration: 0,
					flags: ["is_request", "urgent"],
				},
			},
		]);
		expect(
			result.alerts.find((a) => a.id === "urgent_menstrual_supplies")?.severity,
		).toBe("warning");
	});
});
