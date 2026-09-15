// Build isolé pour l'espace admin uniquement -- ne touche jamais au
// simulateur existant (index.html), qui reste un site statique pur sans
// étape de build. N'introduit PAS de framework (React/Vite) pour ça : un
// bundler minimal (esbuild) qui se contente d'empaqueter @netlify/identity
// avec le code des 3 pages admin.
import { build } from "esbuild";

await build({
  entryPoints: ["admin-src/login.js", "admin-src/dashboard.js", "admin-src/callback.js"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  outdir: "admin",
  minify: false,
  sourcemap: true,
});

console.log("Build admin terminé -> admin/login.js, admin/dashboard.js, admin/callback.js");
