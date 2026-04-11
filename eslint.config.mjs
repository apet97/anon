import tsEslintPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
    },
    plugins: {
      "@typescript-eslint": tsEslintPlugin,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
];
