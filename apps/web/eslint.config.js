// eslint.config.js
import { defineConfig } from "eslint/config";

export default defineConfig([
	{
		extends: ["next/core-web-vitals"],
    ignores: [
      "src/components/ui/background-beams.tsx",
      "src/components/ui/text-generate-effect.tsx"
    ]
	},
]);
