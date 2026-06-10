// @ts-check
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },

  // Non-typed recommended rules — safe defaults for all TS files
  ...tseslint.configs.recommended,

  // Typed rules — require parserOptions.project so we can access type info
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Unused vars are warnings; underscore-prefix exempts intentional ignores
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // `any` is a warning — handy during development, should be cleaned up
      "@typescript-eslint/no-explicit-any": "warn",

      // Unhandled floating promises are a common source of silent failures
      "@typescript-eslint/no-floating-promises": "error",

      // Allow async functions as Express/Router callbacks (checksVoidReturn: false)
      // Without this every `router.get("/", asyncHandler)` would be a lint error.
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: false },
      ],
    },
  }
);
