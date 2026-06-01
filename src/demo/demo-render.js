const clearNode = (node) => {
	while (node.firstChild) node.removeChild(node.firstChild);
};

/** Small element factory keeps class/text setup consistent across render helpers. */
const makeElement = (tagName, { className, text } = {}) => {
	const element = document.createElement(tagName);
	if (className) element.className = className;
	if (text !== undefined) element.textContent = text;
	return element;
};

const textElement = (tagName, text) => makeElement(tagName, { text });

const appendNodes = (root, nodes) =>
	nodes.forEach((node) => {
		root.appendChild(node);
	});

/** Alerts render category first so operators can scan deterministic triggers quickly. */
export const makeAlert = (alert) => {
	const div = makeElement("div", { className: `alert ${alert.severity}` });
	const strong = textElement("strong", alert.severity);
	div.appendChild(strong);
	div.appendChild(document.createTextNode(` · ${alert.message}`));
	return div;
};

/** Stat rows keep labels and numeric values in separate spans for CSS alignment. */
export const makeStat = (key, value) => {
	const row = makeElement("div", { className: "stat" });
	const keySpan = makeElement("span", { className: "key" });
	keySpan.textContent = key;
	const valueSpan = makeElement("span", { className: "val" });
	valueSpan.textContent = String(value);
	row.appendChild(keySpan);
	row.appendChild(valueSpan);
	return row;
};

export const sectionTitle = (text) => {
	return makeElement("div", { className: "section-title", text });
};

/**
 * Queue rendering stays isolated here so the bootstrap module only coordinates
 * state and network calls while this module owns DOM construction details.
 */
export const renderQueue = ({
	root,
	detail,
	queue,
	currentLocale,
	t,
	severityLabel,
}) => {
	const context = { currentLocale, t, severityLabel };
	clearNode(root);
	clearNode(detail);
	if (!queue || queue.groups.length === 0) {
		const paragraph = document.createElement("p");
		paragraph.className = "note";
		paragraph.textContent = isEnglishLocale(currentLocale)
			? "No queued events"
			: "尚無佇列事件";
		root.appendChild(paragraph);
		return;
	}
	queue.groups.forEach((group, index) => {
		const button = document.createElement("button");
		button.className = "btn queue-group";
		button.type = "button";
		button.appendChild(queueGroupTitle(group, t));
		button.appendChild(queueGroupMeta(group, context));
		button.addEventListener("click", () =>
			renderQueueDetail(detail, group, context),
		);
		root.appendChild(button);
		if (index === 0) renderQueueDetail(detail, group, context);
	});
};

export const renderAlerts = (root, alerts) => {
	clearNode(root);
	if (!alerts || alerts.length === 0) {
		const paragraph = document.createElement("p");
		paragraph.className = "note";
		paragraph.textContent = "本情境無觸發（觸發條件見 SPEC.md）";
		root.appendChild(paragraph);
		return;
	}
	for (const alert of alerts) root.appendChild(makeAlert(alert));
};

/**
 * Central summary rendering is kept deterministic and data-only so tests can
 * assert the served module shape without coupling to runtime network behavior.
 */
export const renderCentralView = ({
	root,
	data,
	currentLocale,
	t,
	_severityLabel,
}) => {
	const context = { currentLocale, t, data };
	clearNode(root);
	appendNodes(root, centralSummaryNodes(data.summary, context));
};

const isEnglishLocale = (locale) => locale.startsWith("en");

const localeText = ({ currentLocale }, en, zh) =>
	isEnglishLocale(currentLocale) ? en : zh;

const localTimeParts = (seconds) =>
	new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Taipei",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(new Date(seconds * 1000));

const localTimeValue = (parts, type) =>
	parts.find((part) => part.type === type)?.value ?? "";

/** Queue timestamps are UTC seconds in data, but operators need readable local time. */
const formatEpochLocalTime = (seconds) => {
	const parts = localTimeParts(seconds);
	const year = localTimeValue(parts, "year");
	const month = localTimeValue(parts, "month");
	const day = localTimeValue(parts, "day");
	const hour = localTimeValue(parts, "hour");
	const minute = localTimeValue(parts, "minute");
	return `${year}/${month}/${day} ${hour}:${minute}`;
};

const severityText = (severity, { severityLabel }) =>
	`${severityLabel(severity)} (${severity})`;

/**
 * Central view sections are composed as node arrays so the top-level renderer
 * stays linear while each section owns its small amount of label math.
 */
const centralSummaryNodes = (summary, context) => [
	sectionTitle(localeText(context, "Receiving summary", "比對數字")),
	...statusTotalStats(summary.status_totals, context),
	sectionTitle(localeText(context, "Resource flow", "資源流")),
	...resourceFlowStats(summary, context),
	sectionTitle(localeText(context, "Cross-village totals", "跨村統計")),
	...crossVillageStats(summary, context),
];

/** Keep semantic truth status visible in the operator summary, not only raw JSON. */
const semanticVerificationText = (value, context) =>
	value === "field_observation_unverified_truth"
		? localeText(
				context,
				"Field observation; incident truth requires human reconciliation",
				"現場觀察；事件真實性仍需人工複核",
			)
		: value || localeText(context, "Unknown", "未知");

/** Evacuation and missing counts are derived labels, not raw summary fields. */
const statusTotalStats = (totals, context) => {
	const evacuated =
		totals.evacuated_shelter +
		totals.evacuated_relatives +
		totals.vertical_evacuated +
		totals.self_evacuated_neighbor;
	const missing = totals.address_lost + totals.unknown;
	return [
		makeStat(
			localeText(context, "Semantic verification", "語意驗證"),
			semanticVerificationText(context.data?.semantic_verification, context),
		),
		makeStat(
			localeText(context, "Evacuated total", "已撤離（四種撤離狀態合計）"),
			evacuated,
		),
		makeStat(
			localeText(context, "Missing / unknown", "失蹤 / 未確認"),
			missing,
		),
		makeStat(
			localeText(context, "Rescue needed", "待救援"),
			totals.rescue_needed,
		),
		makeStat(
			localeText(context, "Refused evacuation", "拒絕撤離"),
			totals.refused,
		),
	];
};

/** Offers and requests share the same resource labels but need distinct prefixes. */
const resourceFlowStats = (summary, context) => [
	...resourceStats(
		summary.resource_offers,
		context,
		localeText(context, "Offer: ", "提供："),
	),
	...resourceStats(
		summary.resource_requests,
		context,
		localeText(context, "Request: ", "請求："),
	),
];

/** Village totals keep the bottom section aligned with aggregate API fields. */
const crossVillageStats = (summary, context) => [
	makeStat(
		localeText(context, "Village count", "通報村里數"),
		Object.keys(summary.village_counts).length,
	),
	makeStat(
		localeText(context, "Packet count", "通報總筆數"),
		summary.packet_count,
	),
	makeStat(
		localeText(context, "Terrain event count", "地形事件總數"),
		summary.terrain_events.length,
	),
];

const queueGroupTitle = (group, t) =>
	makeElement("strong", {
		className: "queue-group-title",
		text: `${group.label} · ${t("queue", "cluster_count")} ${group.clusters.length}`,
	});

const queueGroupMetaText = (group, context) => {
	const { t } = context;
	return (
		`${t("queue", "packet_count")} ${group.totalPackets} · ` +
		`${t("queue", "highest_severity")} ${severityText(group.highestSeverity, context)} · ` +
		`${t("queue", "latest_time")} ${formatEpochLocalTime(group.latestTs)}`
	);
};

const queueGroupMeta = (group, context) =>
	makeElement("span", {
		className: "queue-group-meta",
		text: queueGroupMetaText(group, context),
	});

/** Detail rendering reuses one context object so locale labels cannot drift. */
const renderQueueDetail = (root, group, context) => {
	clearNode(root);
	root.appendChild(sectionTitle(group.adminAreaKey));
	for (const cluster of group.clusters) {
		root.appendChild(makeCluster(cluster, context));
	}
};

/** Cluster cards present review state and display weight in a fixed scan order. */
const makeCluster = (cluster, context) => {
	const { t } = context;
	const div = makeElement("div", {
		className: `queue-cluster ${cluster.status}`,
	});
	div.appendChild(clusterHead(cluster, context));
	div.appendChild(makeStat(t("queue", "packet_count"), cluster.count));
	div.appendChild(
		makeStat(
			t("queue", "highest_severity"),
			severityText(cluster.maxSeverity, context),
		),
	);
	div.appendChild(
		makeStat(t("queue", "latest_time"), formatEpochLocalTime(cluster.latestTs)),
	);
	return div;
};

/** The cluster heading keeps event kind and queue state visually paired. */
const clusterHead = (cluster, context) => {
	const { t } = context;
	const head = makeElement("div", { className: "head" });
	const name = document.createElement("strong");
	name.textContent = clusterKindLabel(cluster.kind, context);
	const status = document.createElement("span");
	status.textContent = t("queue", cluster.status);
	head.appendChild(name);
	head.appendChild(status);
	return head;
};

/** Queue cluster keys encode type:value, then localize from the matching table. */
const clusterKindLabel = (kind, { currentLocale, t }) => {
	const [type, value] = kind.split(":");
	if (type === "terrain_event") return t("terrain_event", value);
	if (type === "person_report") return t("status", value);
	if (value === "request")
		return isEnglishLocale(currentLocale) ? "Resource request" : "資源請求";
	return isEnglishLocale(currentLocale) ? "Resource offer" : "資源提供";
};

/** Only non-zero resource totals are rendered to keep the summary compact. */
const resourceStats = (entries, { t }, prefix) =>
	Object.entries(entries)
		.filter(([, value]) => value > 0)
		.map(([key, value]) => makeStat(`${prefix}${t("resource", key)}`, value));
