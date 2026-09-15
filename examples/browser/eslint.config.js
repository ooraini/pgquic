import parser from "@typescript-eslint/parser";
export default [
  {
    files: ["**/*.ts"],
    languageOptions: { parser, parserOptions: { project: "./tsconfig.json" } },
  },
];
