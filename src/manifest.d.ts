// assets/manifest.yml reaches the page as a JSON module (the asset-manifest plugin in
// vite.config.ts); its shape is ResolvedAssetManifest in src/data/assetManifest.ts.
declare module "*/assets/manifest.yml" {
  const manifest: unknown;
  export default manifest;
}
