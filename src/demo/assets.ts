import { readFileSync } from "node:fs";

const textAsset = (path: string, contentType: string) => ({
	body: readFileSync(new URL(path, import.meta.url), "utf8"),
	contentType,
});

/**
 * Demo asset loading is centralized here so adding or renaming front-end files
 * does not keep growing the main fetch router.
 */
export const demoAssets = {
	"/demo.css": textAsset("./demo.css", "text/css; charset=utf-8"),
	"/demo.js": textAsset("./demo.js", "text/javascript; charset=utf-8"),
	"/demo-render.js": textAsset(
		"./demo-render.js",
		"text/javascript; charset=utf-8",
	),
	"/hazard-map.js": textAsset(
		"./hazard-map.js",
		"text/javascript; charset=utf-8",
	),
	"/vendor/scalar-api-reference.js": textAsset(
		"../vendor/scalar-api-reference.js",
		"text/javascript; charset=utf-8",
	),
} as const;
