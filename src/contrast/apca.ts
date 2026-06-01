const NORMAL_BG = 0.56;
const NORMAL_TXT = 0.57;
const REVERSE_BG = 0.65;
const REVERSE_TXT = 0.62;
const SCALE = 1.14;
const LO_THRESH = 0.078;
const LO_OFFSET = 0.027;
const BLK_THRS = 0.022;
const BLK_CLAMP = 1.414;

export const APCA_LC_TARGET = 70;

export interface ContrastCombo {
	readonly label: string;
	readonly text: string;
	readonly bg: string;
	readonly target?: number;
}

export interface ContrastFailure extends ContrastCombo {
	readonly lc: number;
	readonly target: number;
}

export const DEMO_COLORS = {
	bg: "#f6f7f9",
	card: "#fff",
	fg: "#0b1220",
	dim: "#334155",
	amber: "#92400e",
	rose: "#b91c1c",
	orange: "#c2410e",
	"slate-dark": "#1f2937",
	sky: "#0369a1",
} as const;

export const DEMO_READABLE_COMBOS = [
	{ label: "demo body text", text: DEMO_COLORS.fg, bg: DEMO_COLORS.bg },
	{ label: "demo panel text", text: DEMO_COLORS.fg, bg: DEMO_COLORS.card },
	{
		label: "demo muted text on page",
		text: DEMO_COLORS.dim,
		bg: DEMO_COLORS.bg,
	},
	{
		label: "demo muted text on panel",
		text: DEMO_COLORS.dim,
		bg: DEMO_COLORS.card,
	},
	{ label: "demo input text", text: DEMO_COLORS.fg, bg: DEMO_COLORS.bg },
	{
		label: "demo synthetic badge",
		text: DEMO_COLORS.amber,
		bg: DEMO_COLORS.bg,
	},
	{ label: "demo footer link", text: DEMO_COLORS.sky, bg: DEMO_COLORS.bg },
	{
		label: "demo primary button (encode)",
		text: DEMO_COLORS.bg,
		bg: DEMO_COLORS.orange,
	},
	{ label: "demo danger button", text: DEMO_COLORS.bg, bg: DEMO_COLORS.rose },
	{
		label: "demo safe button (dispatch)",
		text: DEMO_COLORS.bg,
		bg: DEMO_COLORS["slate-dark"],
	},
] as const satisfies readonly ContrastCombo[];

/** Normalize CSS hex colors so token audits fail early on unsupported values. */
const normalizeHex = (hexColor: string): string => {
	const raw = hexColor.trim().replace(/^#/, "");
	if (/^[\da-f]{3}$/i.test(raw)) {
		return raw
			.split("")
			.map((char) => `${char}${char}`)
			.join("");
	}
	if (/^[\da-f]{6}$/i.test(raw)) {
		return raw;
	}
	throw new Error(
		`APCA audit only accepts 3- or 6-digit hex colors: ${hexColor}`,
	);
};

/** APCA luminance intentionally follows SAPC gamma 2.4 instead of WCAG2 companding. */
const luminance = (hexColor: string): number => {
	const normalized = normalizeHex(hexColor);
	const channels = [0, 2, 4].map(
		(index) => Number.parseInt(normalized.slice(index, index + 2), 16) / 255,
	);
	const [red = 0, green = 0, blue = 0] = channels;
	return (
		0.2126729 * red ** 2.4 + 0.7151522 * green ** 2.4 + 0.072175 * blue ** 2.4
	);
};

const clampSoftBlack = (luma: number): number =>
	luma < BLK_THRS ? luma + (BLK_THRS - luma) ** BLK_CLAMP : luma;

/** Return signed APCA Lc; positive means dark text on light background. */
export const apcaLc = (text: string, bg: string): number => {
	const yText = clampSoftBlack(luminance(text));
	const yBg = clampSoftBlack(luminance(bg));
	if (yBg > yText) {
		const sapc = (yBg ** NORMAL_BG - yText ** NORMAL_TXT) * SCALE;
		if (sapc < 0.001) {
			return 0;
		}
		return (sapc < LO_THRESH ? sapc - LO_OFFSET : sapc) * 100;
	}
	const sapc = (yBg ** REVERSE_BG - yText ** REVERSE_TXT) * SCALE;
	if (sapc > -0.001) {
		return 0;
	}
	return (sapc > -LO_THRESH ? sapc + LO_OFFSET : sapc) * 100;
};

/** Collect only below-threshold pairs so CI output points directly at fix targets. */
export const auditContrast = (
	combos: readonly ContrastCombo[],
	target = APCA_LC_TARGET,
): ContrastFailure[] =>
	combos
		.map((combo) => {
			const comboTarget = combo.target ?? target;
			return {
				...combo,
				lc: apcaLc(combo.text, combo.bg),
				target: comboTarget,
			};
		})
		.filter(({ lc, target: comboTarget }) => Math.abs(lc) < comboTarget);

/** Format deterministic CLI output matching the local quality gate convention. */
export const formatContrastAudit = (
	combos: readonly ContrastCombo[],
	target = APCA_LC_TARGET,
): string =>
	combos
		.map((combo) => {
			const comboTarget = combo.target ?? target;
			const lc = apcaLc(combo.text, combo.bg);
			const marker = Math.abs(lc) >= comboTarget ? " OK " : "FAIL";
			const signedLc = lc.toFixed(1).padStart(7, " ");
			return `[${marker}] Lc ${signedLc}  ${combo.label.padEnd(28, " ")}  text=${combo.text}  bg=${combo.bg}`;
		})
		.join("\n");
