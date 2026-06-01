export default {
	ignoreFiles: ["temp/**"],
	extends: [
		"stylelint-config-standard",
		"stylelint-plugin-defensive-css/configs/recommended",
	],
	plugins: [
		"stylelint-declaration-block-no-ignored-properties",
		"stylelint-high-performance-animation",
		"stylelint-no-unsupported-browser-features",
		"stylelint-value-no-unknown-custom-properties",
	],
	rules: {
		"csstools/value-no-unknown-custom-properties": true,
		"plugin/declaration-block-no-ignored-properties": true,
		"plugin/no-low-performance-animation-properties": true,
		"plugin/no-unsupported-browser-features": [true, { severity: "warning" }],
	},
};
