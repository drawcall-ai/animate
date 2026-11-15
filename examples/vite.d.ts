// what Vite gives the examples' modules
declare module '*.css'
interface ImportMeta {
  readonly env: { readonly BASE_URL: string }
}
