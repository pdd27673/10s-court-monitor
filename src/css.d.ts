// TypeScript 6+/7 enable noUncheckedSideEffectImports by default.
// Next only ships declarations for *.module.css — global CSS side-effect
// imports (e.g. app/layout.tsx → ./globals.css) need this ambient module.
declare module "*.css";
