declare module "*.wasm" {
  const url: string;
  export default url;
}

declare module "*.img" {
  const url: string;
  export default url;
}

declare module "*.cpio" {
  const bytes: Uint8Array;
  export default bytes;
}
