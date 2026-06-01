#!/usr/bin/env bun

import {
	APCA_LC_TARGET,
	auditContrast,
	DEMO_READABLE_COMBOS,
	formatContrastAudit,
} from "../src/contrast/apca.ts";

const failures = auditContrast(DEMO_READABLE_COMBOS, APCA_LC_TARGET);

console.log(formatContrastAudit(DEMO_READABLE_COMBOS, APCA_LC_TARGET));
console.log(`\n${failures.length} failure(s) at Lc70 target.`);

process.exit(failures.length === 0 ? 0 : 1);
