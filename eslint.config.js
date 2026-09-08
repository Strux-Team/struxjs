import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "public/**",
      "resources/**",
      "strux-core/**",
      "docs-site/**",
      "create-strux-app/**",
      "storage/**",
      ".docs/**"
    ],
  },
  {
    files: ["app/**/*.ts", "config/**/*.ts", "routes/**/*.ts", "database/**/*.ts", "bootstrap*.ts", "*.ts"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { "args": "none", "varsIgnorePattern": "^_" }],
      "no-console": "off",
      "no-empty": ["error", { "allowEmptyCatch": true }],
    },
  },
];
